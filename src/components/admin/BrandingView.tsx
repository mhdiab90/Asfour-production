/**
 * ASFOUR ERP - Static Branding & Visual Identity Administration View
 * 
 * Manages Company Logo and Developer Identity as core static assets.
 * Single Source of Truth:
 * - Company Logo: `/branding/company-logo.png`
 * - Developer Image: `/branding/developer.jpeg`
 * 
 * Mode: STATIC_ASSET (Cloudinary and external upload dependencies removed)
 */
import React, { useState } from 'react';
import { 
  CheckCircle2, 
  ShieldCheck, 
  Layers, 
  Eye, 
  Sparkles, 
  Info, 
  FileCode, 
  Terminal, 
  GitBranch, 
  CloudCheck, 
  FolderArchive,
  RefreshCw
} from 'lucide-react';
import { useBranding } from '../../context/BrandingContext';
import { useLanguage } from '../../i18n/LanguageContext';
import { AsfourLogo } from '../common/AsfourLogo';
import { DeveloperBadge } from '../common/DeveloperBadge';
import { 
  STATIC_COMPANY_LOGO_PATH, 
  STATIC_DEVELOPER_IMAGE_PATH 
} from '../../services/brandingService';

export const BrandingView: React.FC = () => {
  const { 
    companyLogoSrc, 
    developerImageSrc,
    refreshBranding,
    isLoading
  } = useBranding();
  const { language } = useLanguage();

  // Multi-context live preview tab
  const [activePreviewTab, setActivePreviewTab] = useState<'sidebar' | 'header' | 'login' | 'print' | 'about'>('sidebar');
  const [refreshKey, setRefreshKey] = useState<number>(0);

  const handleRefresh = async () => {
    await refreshBranding();
    setRefreshKey(prev => prev + 1);
  };

  return (
    <div className="space-y-8 max-w-7xl mx-auto pb-12" dir={language === 'ar' ? 'rtl' : 'ltr'}>
      {/* Header Banner */}
      <div className="bg-white rounded-2xl p-6 border border-slate-200/80 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 rounded-xl bg-blue-50 border border-blue-200 flex items-center justify-center text-blue-600 shrink-0">
            <Layers className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center gap-2.5 flex-wrap">
              <h1 className="text-xl font-bold text-slate-900">
                {language === 'ar' ? 'إدارة الهوية المؤسسية والأصول البصرية' : 'Branding & Visual Identity Management'}
              </h1>
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                STATIC_ASSET
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-1 leading-relaxed">
              {language === 'ar' 
                ? 'يتم إدارة شعار الشركة وصورة المطور كملفات أساسية داخل إصدار البرنامج لضمان أعلى سرعة وأعلى درجات الاستقرار.' 
                : 'Company branding and developer identity images are managed as core application assets for maximum speed and stability.'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 self-start md:self-auto">
          <button
            type="button"
            onClick={handleRefresh}
            disabled={isLoading}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold transition cursor-pointer disabled:opacity-50"
            title="Reload branding assets"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            <span>{language === 'ar' ? 'تحديث المعاينة' : 'Refresh Preview'}</span>
          </button>
        </div>
      </div>

      {/* Core Informational Notice */}
      <div className="p-4 bg-blue-50/80 border border-blue-200 rounded-2xl flex items-start gap-3.5">
        <Info className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
        <div className="text-xs text-blue-900 leading-relaxed">
          <p className="font-bold text-blue-950 mb-1">
            {language === 'ar'
              ? 'يتم إدارة شعار الشركة وصورة المطور كملفات أساسية داخل إصدار البرنامج.'
              : 'Company branding and developer identity images are managed as core application assets.'}
          </p>
          <p className="text-blue-800/90 text-[11px]">
            {language === 'ar'
              ? 'الأصول الرقمية مدمجة كملفات ثابتة (Static Assets) فائقة الدقة داخل حزمة النظام. هذا يمنع أي اعتماد على خدمات الرفع السحابية الخارجية أو أخطاء التخزين المؤقت، ويوفر تحميل فوري 100% بدون أي تأخير شبكي.'
              : 'Visual assets are compiled as high-fidelity static assets directly into the application distribution. This eliminates external cloud dependencies, removes storage upload errors, and guarantees instant zero-latency rendering.'}
          </p>
        </div>
      </div>

      {/* 2 Primary Asset Cards: Company Logo & Developer Image */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        
        {/* Card 1: Company Logo */}
        <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-xs flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between gap-3 mb-4 pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-orange-50 border border-orange-200 flex items-center justify-center text-orange-600 font-bold text-xs">
                  01
                </div>
                <div>
                  <h2 className="text-sm font-bold text-slate-900">
                    {language === 'ar' ? 'شعار الشركة' : 'Company Logo'}
                  </h2>
                  <p className="text-[11px] text-slate-500 font-mono">
                    {STATIC_COMPANY_LOGO_PATH}
                  </p>
                </div>
              </div>
              <span className="px-2.5 py-1 rounded-full text-[11px] font-semibold bg-blue-50 text-blue-700 border border-blue-200">
                {language === 'ar' ? 'ملف أساسي نشط' : 'Active Core Asset'}
              </span>
            </div>

            {/* Logo Display Container */}
            <div className="bg-slate-50/80 border border-slate-200/80 rounded-xl p-6 flex flex-col items-center justify-center min-h-[190px]">
              <div className="p-4 bg-white rounded-xl border border-slate-200 shadow-xs flex items-center justify-center max-w-full">
                <img
                  key={`company-logo-view-${refreshKey}`}
                  src={companyLogoSrc}
                  alt="ASFOUR Company Logo"
                  className="max-h-24 max-w-full object-contain"
                />
              </div>
              <div className="mt-3 text-center">
                <p className="text-xs font-bold text-slate-800">
                  {language === 'ar' ? 'شعار شركة عصفور الرسمي' : 'Official ASFOUR Factory Logo'}
                </p>
                <p className="text-[11px] text-slate-500 font-mono mt-0.5">
                  public/branding/company-logo.png
                </p>
              </div>
            </div>

            {/* Metadata Badges */}
            <div className="grid grid-cols-2 gap-2.5 mt-4 text-xs">
              <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200/70">
                <span className="text-[10px] text-slate-400 block uppercase tracking-wider font-semibold">
                  {language === 'ar' ? 'نوع الملف' : 'Format'}
                </span>
                <span className="font-semibold text-slate-800 font-mono">PNG (High-Res 100%)</span>
              </div>
              <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200/70">
                <span className="text-[10px] text-slate-400 block uppercase tracking-wider font-semibold">
                  {language === 'ar' ? 'حالة التكامل' : 'Integration'}
                </span>
                <span className="font-semibold text-emerald-700 flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  {language === 'ar' ? 'مدمج ومفعل' : 'Integrated'}
                </span>
              </div>
            </div>
          </div>

          <div className="mt-6 pt-4 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
            <span className="flex items-center gap-1">
              <ShieldCheck className="w-3.5 h-3.5 text-blue-600" />
              {language === 'ar' ? 'دقة أصلية بدون تعديل' : 'Exact original fidelity'}
            </span>
            <span className="font-mono text-[11px] text-slate-400">STATIC_ASSET</span>
          </div>
        </div>

        {/* Card 2: Developer Image */}
        <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-xs flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between gap-3 mb-4 pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-indigo-50 border border-indigo-200 flex items-center justify-center text-indigo-600 font-bold text-xs">
                  02
                </div>
                <div>
                  <h2 className="text-sm font-bold text-slate-900">
                    {language === 'ar' ? 'صورة المطور' : 'Developer Image'}
                  </h2>
                  <p className="text-[11px] text-slate-500 font-mono">
                    {STATIC_DEVELOPER_IMAGE_PATH}
                  </p>
                </div>
              </div>
              <span className="px-2.5 py-1 rounded-full text-[11px] font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200">
                Developed by MHDIAB
              </span>
            </div>

            {/* Developer Image Display Container */}
            <div className="bg-slate-900 text-white rounded-xl p-6 flex flex-col items-center justify-center min-h-[190px] border border-slate-800 shadow-inner">
              <div className="p-1 rounded-xl bg-slate-950 border border-slate-700 shadow-md flex items-center justify-center max-w-full">
                <img
                  key={`dev-image-view-${refreshKey}`}
                  src={developerImageSrc}
                  alt="Developer - MHDIAB"
                  className="max-h-28 max-w-full object-contain rounded-lg"
                />
              </div>
              <div className="mt-3 text-center">
                <p className="text-xs font-bold text-white tracking-wide">
                  Developed by MHDIAB
                </p>
                <p className="text-[11px] text-slate-400 font-mono mt-0.5">
                  public/branding/developer.jpeg
                </p>
              </div>
            </div>

            {/* Metadata Badges */}
            <div className="grid grid-cols-2 gap-2.5 mt-4 text-xs">
              <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200/70">
                <span className="text-[10px] text-slate-400 block uppercase tracking-wider font-semibold">
                  {language === 'ar' ? 'نوع الملف' : 'Format'}
                </span>
                <span className="font-semibold text-slate-800 font-mono">JPEG (Original)</span>
              </div>
              <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200/70">
                <span className="text-[10px] text-slate-400 block uppercase tracking-wider font-semibold">
                  {language === 'ar' ? 'طريقة العرض' : 'Rendering'}
                </span>
                <span className="font-semibold text-indigo-700 font-mono">object-fit: contain</span>
              </div>
            </div>
          </div>

          <div className="mt-6 pt-4 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
            <span className="flex items-center gap-1">
              <Sparkles className="w-3.5 h-3.5 text-indigo-600" />
              {language === 'ar' ? 'عرض متناسق بدون اقتصاص' : 'Proportional uncropped display'}
            </span>
            <span className="font-mono text-[11px] text-slate-400">STATIC_ASSET</span>
          </div>
        </div>

      </div>

      {/* Multi-Context Live Preview Section */}
      <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-xs">
        <div className="flex items-center justify-between gap-4 mb-6 pb-4 border-b border-slate-100 flex-wrap">
          <div>
            <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <Eye className="w-4 h-4 text-blue-600" />
              {language === 'ar' ? 'معاينة حية في سياقات النظام المختلفة' : 'Live Multi-Context Previews'}
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              {language === 'ar' 
                ? 'تحقق من تناسق ومظهر الشعار وصورة المطور في كافة واجهات التطبيق.' 
                : 'Verify visual harmony of logo and developer identity across all app interfaces.'}
            </p>
          </div>

          {/* Context Tab Selector */}
          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-xl border border-slate-200/80">
            <button
              type="button"
              onClick={() => setActivePreviewTab('sidebar')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer ${
                activePreviewTab === 'sidebar' 
                  ? 'bg-white text-slate-900 shadow-xs' 
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {language === 'ar' ? 'الشريط الجانبي' : 'Sidebar'}
            </button>
            <button
              type="button"
              onClick={() => setActivePreviewTab('header')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer ${
                activePreviewTab === 'header' 
                  ? 'bg-white text-slate-900 shadow-xs' 
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {language === 'ar' ? 'الهيدر' : 'Header'}
            </button>
            <button
              type="button"
              onClick={() => setActivePreviewTab('login')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer ${
                activePreviewTab === 'login' 
                  ? 'bg-white text-slate-900 shadow-xs' 
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {language === 'ar' ? 'تسجيل الدخول' : 'Login'}
            </button>
            <button
              type="button"
              onClick={() => setActivePreviewTab('print')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer ${
                activePreviewTab === 'print' 
                  ? 'bg-white text-slate-900 shadow-xs' 
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {language === 'ar' ? 'التقارير' : 'Reports'}
            </button>
            <button
              type="button"
              onClick={() => setActivePreviewTab('about')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer ${
                activePreviewTab === 'about' 
                  ? 'bg-white text-slate-900 shadow-xs' 
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {language === 'ar' ? 'حول النظام' : 'About'}
            </button>
          </div>
        </div>

        {/* Tab Previews */}
        <div className="p-6 rounded-2xl bg-slate-50 border border-slate-200/80 flex items-center justify-center min-h-[160px]">
          {activePreviewTab === 'sidebar' && (
            <div className="w-full max-w-sm bg-slate-900 text-white rounded-xl p-4 border border-slate-800 shadow-md">
              <p className="text-[10px] text-slate-400 mb-2 uppercase tracking-wider font-semibold font-sans">
                Sidebar Brand Header (Dark Surface)
              </p>
              <AsfourLogo variant="sidebar" size="md" />
            </div>
          )}

          {activePreviewTab === 'header' && (
            <div className="w-full max-w-lg bg-white rounded-xl p-4 border border-slate-200 shadow-xs flex items-center justify-between">
              <AsfourLogo variant="header" size="sm" />
              <div className="text-right">
                <span className="text-[11px] font-bold text-slate-800 block">ASFOUR Factory ERP</span>
                <span className="text-[10px] text-slate-400">Production Control System</span>
              </div>
            </div>
          )}

          {activePreviewTab === 'login' && (
            <div className="w-full max-w-md bg-white rounded-2xl p-6 border border-slate-200 shadow-md flex flex-col items-center gap-4">
              <AsfourLogo variant="login" size="xl" />
              <div className="w-full pt-3 border-t border-slate-100 flex justify-center">
                <DeveloperBadge variant="login" />
              </div>
            </div>
          )}

          {activePreviewTab === 'print' && (
            <div className="w-full max-w-lg bg-white rounded-xl p-6 border-2 border-slate-300 shadow-xs">
              <div className="flex items-center justify-between pb-3 border-b-2 border-slate-800 mb-3">
                <AsfourLogo variant="print" size="md" />
                <div className="text-right">
                  <span className="text-xs font-bold text-slate-900 block font-mono">ASFOUR FACTORY REPORT</span>
                  <span className="text-[10px] text-slate-500">Official Production Audit Document</span>
                </div>
              </div>
              <p className="text-xs text-slate-600 leading-relaxed">
                {language === 'ar' ? 'تقرير إنتاج يومي رسمي معتمد - شركة عصفور' : 'Official Verified ASFOUR Factory Production Report'}
              </p>
            </div>
          )}

          {activePreviewTab === 'about' && (
            <div className="w-full max-w-md bg-white rounded-2xl p-6 border border-slate-200 shadow-md flex flex-col items-center">
              <DeveloperBadge variant="about" />
            </div>
          )}
        </div>
      </div>

      {/* Manual Change & Deployment Workflow Guide */}
      <div className="bg-slate-900 text-white rounded-2xl p-6 border border-slate-800 shadow-md">
        <div className="flex items-start gap-3.5 mb-5 pb-4 border-b border-slate-800">
          <GitBranch className="w-5 h-5 text-indigo-400 shrink-0 mt-0.5" />
          <div>
            <h2 className="text-sm font-bold text-white">
              {language === 'ar' ? 'دليل تحديث وتغيير الأصول البصرية (Workflow)' : 'Asset Update & Deployment Workflow'}
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              {language === 'ar'
                ? 'لتغيير الشعار أو صورة المطور في الإصدارات القادمة، اتبع الخطوات القياسية المباشرة التالية:'
                : 'To replace company logo or developer photo in future releases, follow these standard steps:'}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="p-4 rounded-xl bg-slate-950/70 border border-slate-800 flex flex-col justify-between">
            <div>
              <div className="w-7 h-7 rounded-lg bg-blue-500/20 text-blue-400 font-bold text-xs flex items-center justify-center mb-2.5 font-mono">
                1
              </div>
              <p className="text-xs font-bold text-slate-200 mb-1">
                {language === 'ar' ? 'استبدال الملف محلياً' : 'Replace File'}
              </p>
              <p className="text-[11px] text-slate-400 leading-relaxed font-mono">
                /public/branding/
              </p>
            </div>
            <span className="text-[10px] text-slate-500 mt-2 block">
              company-logo.png / developer.jpeg
            </span>
          </div>

          <div className="p-4 rounded-xl bg-slate-950/70 border border-slate-800 flex flex-col justify-between">
            <div>
              <div className="w-7 h-7 rounded-lg bg-indigo-500/20 text-indigo-400 font-bold text-xs flex items-center justify-center mb-2.5 font-mono">
                2
              </div>
              <p className="text-xs font-bold text-slate-200 mb-1">
                {language === 'ar' ? 'رفع التغييرات إلى GitHub' : 'Commit & Push'}
              </p>
              <p className="text-[11px] text-slate-400 leading-relaxed font-mono">
                git push origin main
              </p>
            </div>
            <span className="text-[10px] text-slate-500 mt-2 block">
              Repository: mhdiab90/Asfour-production
            </span>
          </div>

          <div className="p-4 rounded-xl bg-slate-950/70 border border-slate-800 flex flex-col justify-between">
            <div>
              <div className="w-7 h-7 rounded-lg bg-amber-500/20 text-amber-400 font-bold text-xs flex items-center justify-center mb-2.5 font-mono">
                3
              </div>
              <p className="text-xs font-bold text-slate-200 mb-1">
                {language === 'ar' ? 'بناء الحزمة التلقائي' : 'Cloudflare Build'}
              </p>
              <p className="text-[11px] text-slate-400 leading-relaxed font-mono">
                npm run build
              </p>
            </div>
            <span className="text-[10px] text-slate-500 mt-2 block">
              dist/branding/*
            </span>
          </div>

          <div className="p-4 rounded-xl bg-slate-950/70 border border-slate-800 flex flex-col justify-between">
            <div>
              <div className="w-7 h-7 rounded-lg bg-emerald-500/20 text-emerald-400 font-bold text-xs flex items-center justify-center mb-2.5 font-mono">
                4
              </div>
              <p className="text-xs font-bold text-slate-200 mb-1">
                {language === 'ar' ? 'نشر فوري مباشر' : 'Live Production'}
              </p>
              <p className="text-[11px] text-slate-400 leading-relaxed font-mono">
                asfour-production.pages.dev
              </p>
            </div>
            <span className="text-[10px] text-slate-500 mt-2 block">
              100% Zero-Downtime Delivery
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default BrandingView;

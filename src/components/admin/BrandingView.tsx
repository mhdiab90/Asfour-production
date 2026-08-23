/**
 * ASFOUR ERP - Manual Branding & Asset Management View
 * Admin-only interface to upload untouched original Company Logo & Developer Image.
 * Stores assets in Firebase Cloud Storage & metadata in Firestore (`system_settings/branding`).
 * Zero AI regeneration, 100% exact fidelity with live responsive previews.
 */
import React, { useState, useRef } from 'react';
import { 
  Upload, 
  Trash2, 
  RotateCcw, 
  CheckCircle2, 
  AlertCircle, 
  Image as ImageIcon, 
  ShieldCheck, 
  Sparkles, 
  Eye, 
  Info,
  RefreshCw,
  FileText
} from 'lucide-react';
import { useBranding } from '../../context/BrandingContext';
import { useLanguage } from '../../i18n/LanguageContext';
import { AsfourLogo } from '../common/AsfourLogo';
import { DeveloperBadge } from '../common/DeveloperBadge';

export const BrandingView: React.FC = () => {
  const { 
    branding, 
    isSaving, 
    isLoading,
    uploadAndSaveLogo, 
    uploadAndSaveDeveloperImage, 
    deleteLogo, 
    deleteDeveloperImage,
    refreshBranding,
    hasCustomLogo,
    hasCustomDeveloperImage,
    companyLogoSrc,
    developerImageSrc
  } = useBranding();

  const { language, t } = useLanguage();

  // Local pending file states
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreviewUrl, setLogoPreviewUrl] = useState<string | null>(null);
  const [logoDragActive, setLogoDragActive] = useState(false);

  const [devFile, setDevFile] = useState<File | null>(null);
  const [devPreviewUrl, setDevPreviewUrl] = useState<string | null>(null);
  const [devDragActive, setDevDragActive] = useState(false);

  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [activePreviewTab, setActivePreviewTab] = useState<'sidebar' | 'header' | 'login' | 'print'>('sidebar');

  const logoInputRef = useRef<HTMLInputElement>(null);
  const devInputRef = useRef<HTMLInputElement>(null);

  // Logo file selection handler
  const handleLogoSelect = (file: File) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setStatusMessage({
        type: 'error',
        text: language === 'ar' ? 'يرجى اختيار ملف صورة صالح (PNG, JPEG, WEBP, SVG)' : 'Please select a valid image file (PNG, JPEG, WEBP, SVG)'
      });
      return;
    }
    setLogoFile(file);
    const objectUrl = URL.createObjectURL(file);
    setLogoPreviewUrl(objectUrl);
    setStatusMessage(null);
  };

  // Developer file selection handler
  const handleDevSelect = (file: File) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setStatusMessage({
        type: 'error',
        text: language === 'ar' ? 'يرجى اختيار ملف صورة صالح (PNG, JPEG, WEBP, SVG)' : 'Please select a valid image file (PNG, JPEG, WEBP, SVG)'
      });
      return;
    }
    setDevFile(file);
    const objectUrl = URL.createObjectURL(file);
    setDevPreviewUrl(objectUrl);
    setStatusMessage(null);
  };

  // Save Logo
  const handleUploadLogo = async () => {
    if (!logoFile) return;
    try {
      await uploadAndSaveLogo(logoFile);
      setLogoFile(null);
      if (logoPreviewUrl) URL.revokeObjectURL(logoPreviewUrl);
      setLogoPreviewUrl(null);
      setStatusMessage({
        type: 'success',
        text: language === 'ar' ? 'تم رفع وحفظ شعار الشركة بنجاح في التخزين السحابي' : 'Company logo uploaded and saved successfully to Cloud Storage'
      });
    } catch (err: any) {
      setStatusMessage({
        type: 'error',
        text: err?.message || (language === 'ar' ? 'فشل رفع الشعار' : 'Failed to upload company logo')
      });
    }
  };

  // Save Developer Image
  const handleUploadDev = async () => {
    if (!devFile) return;
    try {
      await uploadAndSaveDeveloperImage(devFile);
      setDevFile(null);
      if (devPreviewUrl) URL.revokeObjectURL(devPreviewUrl);
      setDevPreviewUrl(null);
      setStatusMessage({
        type: 'success',
        text: language === 'ar' ? 'تم رفع وحفظ صورة المطور بنجاح في التخزين السحابي' : 'Developer image uploaded and saved successfully to Cloud Storage'
      });
    } catch (err: any) {
      setStatusMessage({
        type: 'error',
        text: err?.message || (language === 'ar' ? 'فشل رفع صورة المطور' : 'Failed to upload developer image')
      });
    }
  };

  // Reset Logo to Default
  const handleResetLogo = async () => {
    const confirmText = language === 'ar'
      ? 'هل أنت متأكد من استعادة شعار الشركة الافتراضي الأصلي؟'
      : 'Are you sure you want to reset to the original default company logo?';
    if (!window.confirm(confirmText)) return;

    try {
      await deleteLogo();
      setLogoFile(null);
      if (logoPreviewUrl) URL.revokeObjectURL(logoPreviewUrl);
      setLogoPreviewUrl(null);
      setStatusMessage({
        type: 'success',
        text: language === 'ar' ? 'تمت استعادة الشعار الأصلي الافتراضي بنجاح' : 'Reset to original default company logo successfully'
      });
    } catch (err: any) {
      setStatusMessage({
        type: 'error',
        text: err?.message || 'Error resetting logo'
      });
    }
  };

  // Reset Developer Image to Default
  const handleResetDev = async () => {
    const confirmText = language === 'ar'
      ? 'هل أنت متأكد من استعادة صورة المطور الافتراضية الأصلية؟'
      : 'Are you sure you want to reset to the original default developer image?';
    if (!window.confirm(confirmText)) return;

    try {
      await deleteDeveloperImage();
      setDevFile(null);
      if (devPreviewUrl) URL.revokeObjectURL(devPreviewUrl);
      setDevPreviewUrl(null);
      setStatusMessage({
        type: 'success',
        text: language === 'ar' ? 'تمت استعادة صورة المطور الأصلية بنجاح' : 'Reset to original default developer image successfully'
      });
    } catch (err: any) {
      setStatusMessage({
        type: 'error',
        text: err?.message || 'Error resetting developer image'
      });
    }
  };

  const formatBytes = (bytes?: number | null) => {
    if (!bytes) return '-';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  const formatDate = (dateStr?: string | null) => {
    if (!dateStr) return '-';
    try {
      const d = new Date(dateStr);
      return d.toLocaleString(language === 'ar' ? 'ar-EG' : 'en-US');
    } catch {
      return dateStr;
    }
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12 animate-in fade-in duration-200">
      {/* Top Banner & Header */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-600 shrink-0">
            <ImageIcon className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-black text-slate-900 tracking-tight">
                {language === 'ar' ? 'إدارة الهوية والشعار المؤسسي' : 'Branding & Visual Identity'}
              </h2>
              <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-blue-50 text-blue-700 border border-blue-200">
                {language === 'ar' ? 'تخزين سحابي مباشر' : 'Cloud Storage'}
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-1 leading-relaxed max-w-2xl">
              {language === 'ar'
                ? 'رفع وتحديث شعار شركة عصفور للتعدين والحراريات وصورة المطور بدون أي تعديل أو توليد اصطناعي، مع الحفاظ الكامل على دقة وجودة الملفات الأصلية.'
                : 'Upload and update ASFOUR Company Logo and Developer Identity directly to Cloud Storage with 100% original file fidelity and zero AI distortion.'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => refreshBranding()}
            disabled={isLoading || isSaving}
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold transition cursor-pointer"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
            <span>{language === 'ar' ? 'تحديث الحالة' : 'Refresh State'}</span>
          </button>
        </div>
      </div>

      {/* Notification status message */}
      {statusMessage && (
        <div
          className={`p-4 rounded-2xl flex items-center gap-3 border ${
            statusMessage.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-rose-50 border-rose-200 text-rose-800'
          }`}
        >
          {statusMessage.type === 'success' ? (
            <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
          ) : (
            <AlertCircle className="w-5 h-5 text-rose-600 shrink-0" />
          )}
          <p className="text-xs font-medium">{statusMessage.text}</p>
        </div>
      )}

      {/* Main Upload Columns */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        
        {/* =====================================================================
            SECTION 1: COMPANY LOGO
           ===================================================================== */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between pb-4 border-b border-slate-100">
              <div className="flex items-center gap-2.5">
                <span className="w-8 h-8 rounded-xl bg-orange-100 text-orange-600 font-bold flex items-center justify-center text-sm">
                  1
                </span>
                <div>
                  <h3 className="text-base font-bold text-slate-900">
                    {language === 'ar' ? 'شعار شركة عصفور للتعدين والحراريات' : 'ASFOUR Company Logo'}
                  </h3>
                  <span className="text-[11px] text-slate-500">
                    {language === 'ar' ? 'يظهر في الشريط العلوي، القائمة، وتسجيل الدخول والتقارير' : 'Header, Sidebar, Login, and Official Reports'}
                  </span>
                </div>
              </div>

              {hasCustomLogo ? (
                <span className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  {language === 'ar' ? 'مخصص ومحفوظ' : 'Custom Active'}
                </span>
              ) : (
                <span className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-slate-100 text-slate-600 border border-slate-200">
                  {language === 'ar' ? 'الأصلي الافتراضي' : 'Default Asset'}
                </span>
              )}
            </div>

            {/* Current Active Preview Box */}
            <div className="mt-5 p-4 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-center min-h-[160px]">
              {logoPreviewUrl ? (
                <div className="flex flex-col items-center gap-2">
                  <span className="text-[10px] font-bold text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full">
                    {language === 'ar' ? 'معاينة الملف الجديد قبل الحفظ' : 'New File Preview (Pending Upload)'}
                  </span>
                  <img
                    src={logoPreviewUrl}
                    alt="Logo Preview"
                    className="max-h-28 max-w-full object-contain drop-shadow-sm"
                  />
                  <span className="text-xs text-slate-600 font-mono">
                    {logoFile?.name} ({formatBytes(logoFile?.size)})
                  </span>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-2">
                  <img
                    src={companyLogoSrc}
                    alt="Company Logo Active"
                    className="max-h-28 max-w-full object-contain drop-shadow-sm"
                  />
                  <span className="text-xs text-slate-400">
                    {hasCustomLogo 
                      ? (branding.companyLogoFileName || 'Uploaded Custom Logo') 
                      : (language === 'ar' ? 'الملف الأصلي: /branding/asfour-logo-original.png' : 'Original file: /branding/asfour-logo-original.png')}
                  </span>
                </div>
              )}
            </div>

            {/* Drag and Drop Zone */}
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setLogoDragActive(true);
              }}
              onDragLeave={() => setLogoDragActive(false)}
              onDrop={(e) => {
                e.preventDefault();
                setLogoDragActive(false);
                if (e.dataTransfer.files && e.dataTransfer.files[0]) {
                  handleLogoSelect(e.dataTransfer.files[0]);
                }
              }}
              onClick={() => logoInputRef.current?.click()}
              className={`mt-4 p-6 rounded-2xl border-2 border-dashed transition cursor-pointer flex flex-col items-center justify-center text-center ${
                logoDragActive
                  ? 'border-orange-500 bg-orange-50/50'
                  : 'border-slate-300 hover:border-orange-400 hover:bg-slate-50/70'
              }`}
            >
              <input
                ref={logoInputRef}
                type="file"
                accept="image/png, image/jpeg, image/jpg, image/webp, image/svg+xml"
                onChange={(e) => {
                  if (e.target.files && e.target.files[0]) {
                    handleLogoSelect(e.target.files[0]);
                  }
                }}
                className="hidden"
              />
              <Upload className="w-8 h-8 text-orange-500 mb-2" />
              <p className="text-xs font-bold text-slate-800">
                {language === 'ar' ? 'انقر لاختيار ملف الشعار أو اسحبه وأفلته هنا' : 'Click to select logo file or drag & drop here'}
              </p>
              <p className="text-[11px] text-slate-500 mt-1">
                {language === 'ar' ? 'يدعم PNG, JPG, JPEG, WEBP, SVG حتى 10 ميجابايت' : 'Supports PNG, JPG, WEBP, SVG up to 10MB'}
              </p>
            </div>

            {/* Metadata info */}
            {hasCustomLogo && (
              <div className="mt-4 p-3.5 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-600 space-y-1">
                <div className="flex justify-between">
                  <span className="text-slate-400">{language === 'ar' ? 'اسم الملف:' : 'File Name:'}</span>
                  <span className="font-mono text-slate-800">{branding.companyLogoFileName || '-'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">{language === 'ar' ? 'الحجم:' : 'Size:'}</span>
                  <span className="font-mono text-slate-800">{formatBytes(branding.companyLogoSize)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">{language === 'ar' ? 'تاريخ الرفع:' : 'Uploaded At:'}</span>
                  <span className="font-mono text-slate-800">{formatDate(branding.companyLogoUpdatedAt)}</span>
                </div>
              </div>
            )}
          </div>

          {/* Action buttons */}
          <div className="mt-6 pt-4 border-t border-slate-100 flex items-center justify-between gap-3">
            {logoFile ? (
              <div className="flex items-center gap-2 w-full">
                <button
                  type="button"
                  onClick={handleUploadLogo}
                  disabled={isSaving}
                  className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-orange-600 hover:bg-orange-700 text-white text-xs font-bold shadow-md shadow-orange-600/20 transition cursor-pointer disabled:opacity-50"
                >
                  <Upload className="w-4 h-4" />
                  <span>{isSaving ? (language === 'ar' ? 'جارٍ الرفع والحفظ...' : 'Uploading...') : (language === 'ar' ? 'حفظ وتثبيت الشعار' : 'Save & Publish Logo')}</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setLogoFile(null);
                    if (logoPreviewUrl) URL.revokeObjectURL(logoPreviewUrl);
                    setLogoPreviewUrl(null);
                  }}
                  className="px-3.5 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold transition cursor-pointer"
                >
                  {language === 'ar' ? 'إلغاء' : 'Cancel'}
                </button>
              </div>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => logoInputRef.current?.click()}
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold transition cursor-pointer"
                >
                  <Upload className="w-4 h-4 text-orange-400" />
                  <span>{language === 'ar' ? 'اختيار ملف جديد' : 'Select New File'}</span>
                </button>

                {hasCustomLogo && (
                  <button
                    type="button"
                    onClick={handleResetLogo}
                    disabled={isSaving}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-rose-600 hover:bg-rose-50 text-xs font-semibold transition cursor-pointer"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>{language === 'ar' ? 'استعادة الافتراضي' : 'Reset to Default'}</span>
                  </button>
                )}
              </>
            )}
          </div>
        </div>

        {/* =====================================================================
            SECTION 2: DEVELOPER IMAGE
           ===================================================================== */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between pb-4 border-b border-slate-100">
              <div className="flex items-center gap-2.5">
                <span className="w-8 h-8 rounded-xl bg-indigo-100 text-indigo-600 font-bold flex items-center justify-center text-sm">
                  2
                </span>
                <div>
                  <h3 className="text-base font-bold text-slate-900">
                    {language === 'ar' ? 'صورة المطور (MHDIAB)' : 'Developer Image (MHDIAB)'}
                  </h3>
                  <span className="text-[11px] text-slate-500">
                    {language === 'ar' ? 'تظهر في شاشة معلومات المنظومة، حول النظام، وشارة المطور' : 'About modal, system info, and developer badge'}
                  </span>
                </div>
              </div>

              {hasCustomDeveloperImage ? (
                <span className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  {language === 'ar' ? 'مخصص ومحفوظ' : 'Custom Active'}
                </span>
              ) : (
                <span className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-slate-100 text-slate-600 border border-slate-200">
                  {language === 'ar' ? 'الأصلي الافتراضي' : 'Default Asset'}
                </span>
              )}
            </div>

            {/* Current Active Preview Box */}
            <div className="mt-5 p-4 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-center min-h-[160px]">
              {devPreviewUrl ? (
                <div className="flex flex-col items-center gap-2">
                  <span className="text-[10px] font-bold text-indigo-700 bg-indigo-100 px-2 py-0.5 rounded-full">
                    {language === 'ar' ? 'معاينة الصورة الجديدة قبل الحفظ' : 'New Image Preview (Pending Upload)'}
                  </span>
                  <div className="w-24 h-24 rounded-full overflow-hidden border-2 border-indigo-500 shadow-md">
                    <img
                      src={devPreviewUrl}
                      alt="Developer Preview"
                      className="w-full h-full object-cover"
                    />
                  </div>
                  <span className="text-xs text-slate-600 font-mono">
                    {devFile?.name} ({formatBytes(devFile?.size)})
                  </span>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-2">
                  <div className="w-24 h-24 rounded-full overflow-hidden border-2 border-slate-400 shadow-md bg-slate-900">
                    <img
                      src={developerImageSrc}
                      alt="Developer Active"
                      className="w-full h-full object-cover"
                    />
                  </div>
                  <span className="text-xs text-slate-400">
                    {hasCustomDeveloperImage 
                      ? (branding.developerImageFileName || 'Uploaded Developer Photo') 
                      : (language === 'ar' ? 'الملف الأصلي: /branding/developer-original.png' : 'Original file: /branding/developer-original.png')}
                  </span>
                </div>
              )}
            </div>

            {/* Drag and Drop Zone */}
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDevDragActive(true);
              }}
              onDragLeave={() => setDevDragActive(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDevDragActive(false);
                if (e.dataTransfer.files && e.dataTransfer.files[0]) {
                  handleDevSelect(e.dataTransfer.files[0]);
                }
              }}
              onClick={() => devInputRef.current?.click()}
              className={`mt-4 p-6 rounded-2xl border-2 border-dashed transition cursor-pointer flex flex-col items-center justify-center text-center ${
                devDragActive
                  ? 'border-indigo-500 bg-indigo-50/50'
                  : 'border-slate-300 hover:border-indigo-400 hover:bg-slate-50/70'
              }`}
            >
              <input
                ref={devInputRef}
                type="file"
                accept="image/png, image/jpeg, image/jpg, image/webp"
                onChange={(e) => {
                  if (e.target.files && e.target.files[0]) {
                    handleDevSelect(e.target.files[0]);
                  }
                }}
                className="hidden"
              />
              <Upload className="w-8 h-8 text-indigo-500 mb-2" />
              <p className="text-xs font-bold text-slate-800">
                {language === 'ar' ? 'انقر لاختيار صورة المطور أو اسحبها وأفلتها هنا' : 'Click to select developer photo or drag & drop here'}
              </p>
              <p className="text-[11px] text-slate-500 mt-1">
                {language === 'ar' ? 'يدعم PNG, JPG, JPEG, WEBP حتى 10 ميجابايت' : 'Supports PNG, JPG, WEBP up to 10MB'}
              </p>
            </div>

            {/* Metadata info */}
            {hasCustomDeveloperImage && (
              <div className="mt-4 p-3.5 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-600 space-y-1">
                <div className="flex justify-between">
                  <span className="text-slate-400">{language === 'ar' ? 'اسم الملف:' : 'File Name:'}</span>
                  <span className="font-mono text-slate-800">{branding.developerImageFileName || '-'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">{language === 'ar' ? 'الحجم:' : 'Size:'}</span>
                  <span className="font-mono text-slate-800">{formatBytes(branding.developerImageSize)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">{language === 'ar' ? 'تاريخ الرفع:' : 'Uploaded At:'}</span>
                  <span className="font-mono text-slate-800">{formatDate(branding.developerImageUpdatedAt)}</span>
                </div>
              </div>
            )}
          </div>

          {/* Action buttons */}
          <div className="mt-6 pt-4 border-t border-slate-100 flex items-center justify-between gap-3">
            {devFile ? (
              <div className="flex items-center gap-2 w-full">
                <button
                  type="button"
                  onClick={handleUploadDev}
                  disabled={isSaving}
                  className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold shadow-md shadow-indigo-600/20 transition cursor-pointer disabled:opacity-50"
                >
                  <Upload className="w-4 h-4" />
                  <span>{isSaving ? (language === 'ar' ? 'جارٍ الرفع والحفظ...' : 'Uploading...') : (language === 'ar' ? 'حفظ وتثبيت الصورة' : 'Save & Publish Photo')}</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setDevFile(null);
                    if (devPreviewUrl) URL.revokeObjectURL(devPreviewUrl);
                    setDevPreviewUrl(null);
                  }}
                  className="px-3.5 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold transition cursor-pointer"
                >
                  {language === 'ar' ? 'إلغاء' : 'Cancel'}
                </button>
              </div>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => devInputRef.current?.click()}
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold transition cursor-pointer"
                >
                  <Upload className="w-4 h-4 text-indigo-400" />
                  <span>{language === 'ar' ? 'اختيار ملف جديد' : 'Select New File'}</span>
                </button>

                {hasCustomDeveloperImage && (
                  <button
                    type="button"
                    onClick={handleResetDev}
                    disabled={isSaving}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-rose-600 hover:bg-rose-50 text-xs font-semibold transition cursor-pointer"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>{language === 'ar' ? 'استعادة الافتراضي' : 'Reset to Default'}</span>
                  </button>
                )}
              </>
            )}
          </div>
        </div>

      </div>

      {/* =====================================================================
          SECTION 3: LIVE PREVIEW MATRIX ACROSS ALL UI CONTEXTS
         ===================================================================== */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between pb-4 border-b border-slate-100 gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-50 border border-blue-200 flex items-center justify-center text-blue-600">
              <Eye className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900">
                {language === 'ar' ? 'المعاينة الحية التفاعلية في واجهات المنظومة' : 'Live Interactive Preview in App Contexts'}
              </h3>
              <p className="text-xs text-slate-500">
                {language === 'ar'
                  ? 'شاهد كيف يظهر الشعار وصورة المطور في كافة مواقع النظام بدقة واستجابة كاملة'
                  : 'See how branding looks across Sidebar, Header, Login Screen, and Printed Reports'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 bg-slate-100 p-1 rounded-xl">
            <button
              type="button"
              onClick={() => setActivePreviewTab('sidebar')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
                activePreviewTab === 'sidebar' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {language === 'ar' ? 'القائمة الجانبية' : 'Sidebar'}
            </button>
            <button
              type="button"
              onClick={() => setActivePreviewTab('header')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
                activePreviewTab === 'header' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {language === 'ar' ? 'الشريط العلوي' : 'Header'}
            </button>
            <button
              type="button"
              onClick={() => setActivePreviewTab('login')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
                activePreviewTab === 'login' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {language === 'ar' ? 'شاشة الدخول' : 'Login'}
            </button>
            <button
              type="button"
              onClick={() => setActivePreviewTab('print')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
                activePreviewTab === 'print' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {language === 'ar' ? 'ترويسة التقارير' : 'Report Print'}
            </button>
          </div>
        </div>

        {/* Dynamic Context Preview Area */}
        <div className="mt-6">
          {activePreviewTab === 'sidebar' && (
            <div className="p-6 rounded-2xl bg-slate-950 border border-slate-800 flex flex-col items-start gap-4">
              <span className="text-[11px] font-mono text-slate-400 uppercase tracking-widest">
                Dark Sidebar Context (bg-slate-950)
              </span>
              <div className="p-3 rounded-xl bg-slate-900/90 border border-slate-800 w-full max-w-sm">
                <AsfourLogo variant="sidebar" />
              </div>
            </div>
          )}

          {activePreviewTab === 'header' && (
            <div className="p-6 rounded-2xl bg-slate-50 border border-slate-200 flex flex-col gap-4">
              <span className="text-[11px] font-mono text-slate-500 uppercase tracking-widest">
                Light Topbar Header Context (bg-white border-b)
              </span>
              <div className="p-3 rounded-xl bg-white border border-slate-200 shadow-xs flex items-center justify-between">
                <AsfourLogo variant="header" />
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-400 font-medium">{language === 'ar' ? 'المستخدم: المشرف العام' : 'User: Super Admin'}</span>
                  <div className="w-8 h-8 rounded-full bg-slate-200 flex items-center justify-center font-bold text-xs text-slate-700">
                    AD
                  </div>
                </div>
              </div>
            </div>
          )}

          {activePreviewTab === 'login' && (
            <div className="p-8 rounded-2xl bg-gradient-to-br from-slate-950 via-slate-900 to-indigo-950 border border-slate-800 flex flex-col items-center justify-center">
              <span className="text-[11px] font-mono text-slate-400 uppercase tracking-widest mb-6">
                Login Page Corporate Header
              </span>
              <AsfourLogo variant="login" />
              <div className="mt-8">
                <DeveloperBadge variant="login" />
              </div>
            </div>
          )}

          {activePreviewTab === 'print' && (
            <div className="p-6 rounded-2xl bg-white border-2 border-slate-900 flex flex-col gap-4 shadow-md">
              <span className="text-[11px] font-mono text-slate-500 uppercase tracking-widest">
                Official Report Print Header (ISO 9001:2015 Layout)
              </span>
              <AsfourLogo variant="print" />
            </div>
          )}
        </div>

        {/* Developer About Card Preview */}
        <div className="mt-6 pt-6 border-t border-slate-100">
          <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider mb-3">
            {language === 'ar' ? 'معاينة بطاقة المطور في شاشة (حول النظام):' : 'Developer Identity Preview in About Modal:'}
          </h4>
          <DeveloperBadge variant="about" />
        </div>
      </div>
    </div>
  );
};

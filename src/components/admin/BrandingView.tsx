/**
 * ASFOUR ERP - Manual Branding & Asset Management View
 * Admin-only interface to upload untouched original Company Logo & Developer Image.
 * Stores assets in Firebase Cloud Storage & metadata in Firestore (`system_settings/branding`).
 * Zero AI regeneration, 100% exact fidelity with live progress and responsive previews.
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
  FileText,
  FileCheck,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  X
} from 'lucide-react';
import { useBranding } from '../../context/BrandingContext';
import { useLanguage } from '../../i18n/LanguageContext';
import { useAuth } from '../../context/AuthContext';
import { AsfourLogo } from '../common/AsfourLogo';
import { DeveloperBadge } from '../common/DeveloperBadge';
import { ALLOWED_IMAGE_TYPES, MAX_FILE_SIZE_BYTES } from '../../services/brandingService';

export const BrandingView: React.FC = () => {
  const { 
    branding, 
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

  const { language } = useLanguage();
  const { isSuperAdmin, currentUser } = useAuth();

  // Independent Logo Upload State
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreviewUrl, setLogoPreviewUrl] = useState<string | null>(null);
  const [logoDragActive, setLogoDragActive] = useState<boolean>(false);
  const [logoUploading, setLogoUploading] = useState<boolean>(false);
  const [logoProgress, setLogoProgress] = useState<number>(0);
  const [logoError, setLogoError] = useState<{ message: string; raw?: string; code?: string } | null>(null);
  const [logoSuccess, setLogoSuccess] = useState<string | null>(null);
  const [showLogoTechDetails, setShowLogoTechDetails] = useState<boolean>(false);

  // Independent Developer Image Upload State
  const [devFile, setDevFile] = useState<File | null>(null);
  const [devPreviewUrl, setDevPreviewUrl] = useState<string | null>(null);
  const [devDragActive, setDevDragActive] = useState<boolean>(false);
  const [devUploading, setDevUploading] = useState<boolean>(false);
  const [devProgress, setDevProgress] = useState<number>(0);
  const [devError, setDevError] = useState<{ message: string; raw?: string; code?: string } | null>(null);
  const [devSuccess, setDevSuccess] = useState<string | null>(null);
  const [showDevTechDetails, setShowDevTechDetails] = useState<boolean>(false);

  // Preview Context Tab
  const [activePreviewTab, setActivePreviewTab] = useState<'sidebar' | 'header' | 'login' | 'print'>('sidebar');

  const logoInputRef = useRef<HTMLInputElement>(null);
  const devInputRef = useRef<HTMLInputElement>(null);

  // Helpers
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

  // Logo file selection & pre-validation
  const handleLogoSelect = (file: File) => {
    if (!file) return;
    setLogoError(null);
    setLogoSuccess(null);

    const type = file.type?.toLowerCase() || '';
    if (!ALLOWED_IMAGE_TYPES.includes(type)) {
      setLogoError({
        message: language === 'ar' 
          ? 'نوع الملف غير مدعوم (المسموح: PNG, JPG, JPEG, WEBP فقط).' 
          : 'Unsupported file type (Allowed: PNG, JPG, JPEG, WEBP only).',
        code: 'validation/invalid-type',
      });
      return;
    }

    if (file.size > MAX_FILE_SIZE_BYTES) {
      setLogoError({
        message: language === 'ar'
          ? `حجم الصورة (${(file.size / (1024 * 1024)).toFixed(2)} ميجابايت) أكبر من الحد المسموح (5 ميجابايت).`
          : `Image size exceeds the allowed limit of 5MB (${(file.size / (1024 * 1024)).toFixed(2)}MB).`,
        code: 'validation/size-exceeded',
      });
      return;
    }

    setLogoFile(file);
    const objectUrl = URL.createObjectURL(file);
    setLogoPreviewUrl(objectUrl);
  };

  // Developer image selection & pre-validation
  const handleDevSelect = (file: File) => {
    if (!file) return;
    setDevError(null);
    setDevSuccess(null);

    const type = file.type?.toLowerCase() || '';
    if (!ALLOWED_IMAGE_TYPES.includes(type)) {
      setDevError({
        message: language === 'ar' 
          ? 'نوع الملف غير مدعوم (المسموح: PNG, JPG, JPEG, WEBP فقط).' 
          : 'Unsupported file type (Allowed: PNG, JPG, JPEG, WEBP only).',
        code: 'validation/invalid-type',
      });
      return;
    }

    if (file.size > MAX_FILE_SIZE_BYTES) {
      setDevError({
        message: language === 'ar'
          ? `حجم الصورة (${(file.size / (1024 * 1024)).toFixed(2)} ميجابايت) أكبر من الحد المسموح (5 ميجابايت).`
          : `Image size exceeds the allowed limit of 5MB (${(file.size / (1024 * 1024)).toFixed(2)}MB).`,
        code: 'validation/size-exceeded',
      });
      return;
    }

    setDevFile(file);
    const objectUrl = URL.createObjectURL(file);
    setDevPreviewUrl(objectUrl);
  };

  // Upload Logo handler
  const handleUploadLogo = async () => {
    if (!logoFile) return;

    if (!isSuperAdmin && currentUser?.email !== 'ai.mhdiab90@gmail.com') {
      setLogoError({
        message: language === 'ar' ? 'غير مصرح برفع الصور (صلاحية المشرف العام مطلوبة)' : 'Not authorized to upload branding assets',
        code: 'auth/unauthorized'
      });
      return;
    }

    setLogoUploading(true);
    setLogoProgress(0);
    setLogoError(null);
    setLogoSuccess(null);

    try {
      await uploadAndSaveLogo(logoFile, (progress) => {
        setLogoProgress(progress);
      });

      setLogoProgress(100);
      setLogoSuccess(
        language === 'ar' 
          ? 'تم رفع شعار الشركة بنجاح وتثبيته في التخزين السحابي.' 
          : 'Company logo uploaded successfully and saved to cloud storage.'
      );

      // Clean pending selection
      setLogoFile(null);
      if (logoPreviewUrl) URL.revokeObjectURL(logoPreviewUrl);
      setLogoPreviewUrl(null);
    } catch (err: any) {
      const errMsg = err?.message || (language === 'ar' ? 'تعذر رفع الشعار. تحقق من الاتصال أو الصلاحيات.' : 'Failed to upload company logo.');
      setLogoError({
        message: errMsg,
        raw: String(err),
        code: err?.code || 'storage/upload-failed',
      });
    } finally {
      setLogoUploading(false);
    }
  };

  // Upload Developer Image handler
  const handleUploadDev = async () => {
    if (!devFile) return;

    if (!isSuperAdmin && currentUser?.email !== 'ai.mhdiab90@gmail.com') {
      setDevError({
        message: language === 'ar' ? 'غير مصرح برفع الصور (صلاحية المشرف العام مطلوبة)' : 'Not authorized to upload branding assets',
        code: 'auth/unauthorized'
      });
      return;
    }

    setDevUploading(true);
    setDevProgress(0);
    setDevError(null);
    setDevSuccess(null);

    try {
      await uploadAndSaveDeveloperImage(devFile, (progress) => {
        setDevProgress(progress);
      });

      setDevProgress(100);
      setDevSuccess(
        language === 'ar' 
          ? 'تم رفع صورة المطور بنجاح وتثبيتها في التخزين السحابي.' 
          : 'Developer image uploaded successfully and saved to cloud storage.'
      );

      // Clean pending selection
      setDevFile(null);
      if (devPreviewUrl) URL.revokeObjectURL(devPreviewUrl);
      setDevPreviewUrl(null);
    } catch (err: any) {
      const errMsg = err?.message || (language === 'ar' ? 'تعذر رفع صورة المطور. تحقق من الاتصال أو الصلاحيات.' : 'Failed to upload developer image.');
      setDevError({
        message: errMsg,
        raw: String(err),
        code: err?.code || 'storage/upload-failed',
      });
    } finally {
      setDevUploading(false);
    }
  };

  // Reset / Delete Logo
  const handleResetLogo = async () => {
    const confirmText = language === 'ar'
      ? 'هل أنت متأكد من حذف الصورة واستعادة الشعار الأصلي الافتراضي؟'
      : 'Are you sure you want to delete this image and restore the default logo?';
    if (!window.confirm(confirmText)) return;

    setLogoError(null);
    setLogoSuccess(null);

    try {
      await deleteLogo();
      setLogoFile(null);
      if (logoPreviewUrl) URL.revokeObjectURL(logoPreviewUrl);
      setLogoPreviewUrl(null);
      setLogoSuccess(
        language === 'ar' 
          ? 'تمت استعادة الشعار الأصلي الافتراضي بنجاح.' 
          : 'Reset to original default company logo successfully.'
      );
    } catch (err: any) {
      setLogoError({
        message: err?.message || (language === 'ar' ? 'فشل حذف الشعار' : 'Failed to delete logo'),
        raw: String(err),
      });
    }
  };

  // Reset / Delete Developer Image
  const handleResetDev = async () => {
    const confirmText = language === 'ar'
      ? 'هل أنت متأكد من حذف الصورة واستعادة صورة المطور الافتراضية؟'
      : 'Are you sure you want to delete this image and restore the default developer image?';
    if (!window.confirm(confirmText)) return;

    setDevError(null);
    setDevSuccess(null);

    try {
      await deleteDeveloperImage();
      setDevFile(null);
      if (devPreviewUrl) URL.revokeObjectURL(devPreviewUrl);
      setDevPreviewUrl(null);
      setDevSuccess(
        language === 'ar' 
          ? 'تمت استعادة صورة المطور الأصلية بنجاح.' 
          : 'Reset to original default developer image successfully.'
      );
    } catch (err: any) {
      setDevError({
        message: err?.message || (language === 'ar' ? 'فشل حذف صورة المطور' : 'Failed to delete developer image'),
        raw: String(err),
      });
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
                ? 'رفع وتحديث شعار شركة عصفور للتعدين والحراريات وصورة المطور مباشرة بدون أي تعديل أو توليد اصطناعي، مع الحفاظ الكامل على دقة وجودة الملفات الأصلية.'
                : 'Upload and update ASFOUR Company Logo and Developer Identity directly to Cloud Storage with 100% original file fidelity.'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => refreshBranding()}
            disabled={isLoading || logoUploading || devUploading}
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold transition cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
            <span>{language === 'ar' ? 'تحديث الحالة' : 'Refresh State'}</span>
          </button>
        </div>
      </div>

      {/* Main Upload Columns: 2 Independent Sections */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        
        {/* =====================================================================
            SECTION 1: COMPANY LOGO
           ===================================================================== */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 flex flex-col justify-between">
          <div>
            {/* Header */}
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

            {/* Logo Status Alerts */}
            {logoSuccess && (
              <div className="mt-4 p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 flex items-start gap-2.5 text-xs">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="font-semibold">{logoSuccess}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setLogoSuccess(null)}
                  className="text-emerald-500 hover:text-emerald-700 p-0.5"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            {logoError && (
              <div className="mt-4 p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 space-y-2 text-xs">
                <div className="flex items-start gap-2.5">
                  <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <p className="font-semibold">{logoError.message}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setLogoError(null)}
                    className="text-rose-500 hover:text-rose-700 p-0.5"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>

                {/* Technical Diagnostic for Super Admin */}
                {logoError.code && (
                  <div className="pt-1 border-t border-rose-200/60">
                    <button
                      type="button"
                      onClick={() => setShowLogoTechDetails(!showLogoTechDetails)}
                      className="text-[11px] font-mono text-rose-700 hover:underline flex items-center gap-1"
                    >
                      <span>{language === 'ar' ? 'التفاصيل التقنية للخطأ:' : 'Technical Error Details:'} ({logoError.code})</span>
                      {showLogoTechDetails ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                    </button>
                    {showLogoTechDetails && (
                      <pre className="mt-1.5 p-2 rounded bg-rose-100/70 font-mono text-[10px] text-rose-950 overflow-x-auto whitespace-pre-wrap">
                        {logoError.raw || logoError.message}
                      </pre>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Current Active or Pending Preview Box */}
            <div className="mt-4 p-4 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-center min-h-[160px]">
              {logoPreviewUrl ? (
                <div className="flex flex-col items-center gap-2 w-full">
                  <span className="text-[10px] font-bold text-amber-700 bg-amber-100 px-2.5 py-0.5 rounded-full flex items-center gap-1">
                    <FileCheck className="w-3 h-3" />
                    {language === 'ar' ? 'معاينة الملف المختار (قبل الرفع)' : 'Selected File Preview (Pending Upload)'}
                  </span>
                  <img
                    src={logoPreviewUrl}
                    alt="Logo Preview"
                    className="max-h-28 max-w-full object-contain drop-shadow-sm"
                  />
                  <div className="flex items-center gap-3 text-[11px] text-slate-600 font-mono bg-white px-3 py-1 rounded-lg border border-slate-200 shadow-2xs">
                    <span>{logoFile?.name}</span>
                    <span className="text-slate-300">|</span>
                    <span className="font-bold text-orange-600">{formatBytes(logoFile?.size)}</span>
                    <span className="text-slate-300">|</span>
                    <span className="text-slate-400">{logoFile?.type || 'image/png'}</span>
                  </div>
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
                      : (language === 'ar' ? 'الشعار الأصلي الافتراضي' : 'Default Asset')}
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
              className={`mt-4 p-5 rounded-2xl border-2 border-dashed transition cursor-pointer flex flex-col items-center justify-center text-center ${
                logoDragActive
                  ? 'border-orange-500 bg-orange-50/50'
                  : 'border-slate-300 hover:border-orange-400 hover:bg-slate-50/70'
              }`}
            >
              <input
                ref={logoInputRef}
                type="file"
                accept="image/png, image/jpeg, image/jpg, image/webp"
                onChange={(e) => {
                  if (e.target.files && e.target.files[0]) {
                    handleLogoSelect(e.target.files[0]);
                  }
                }}
                className="hidden"
              />
              <Upload className="w-7 h-7 text-orange-500 mb-1.5" />
              <p className="text-xs font-bold text-slate-800">
                {language === 'ar' ? 'انقر لاختيار ملف الشعار أو اسحبه وأفلته هنا' : 'Click to select logo file or drag & drop here'}
              </p>
              <p className="text-[11px] text-slate-500 mt-0.5">
                {language === 'ar' ? 'PNG, JPG, JPEG, WEBP حتى 5 ميجابايت' : 'PNG, JPG, JPEG, WEBP up to 5MB'}
              </p>
            </div>

            {/* Real Progress Bar during upload */}
            {logoUploading && (
              <div className="mt-4 p-3.5 rounded-xl bg-orange-50/70 border border-orange-200 space-y-2">
                <div className="flex items-center justify-between text-xs font-bold text-orange-900">
                  <span className="flex items-center gap-1.5">
                    <RefreshCw className="w-3.5 h-3.5 animate-spin text-orange-600" />
                    {language === 'ar' ? `جاري الرفع ${logoProgress}%` : `Uploading ${logoProgress}%`}
                  </span>
                  <span className="font-mono">{logoProgress}%</span>
                </div>
                <div className="w-full h-2 rounded-full bg-orange-200 overflow-hidden">
                  <div 
                    className="h-full bg-gradient-to-r from-orange-500 to-amber-500 transition-all duration-300 rounded-full"
                    style={{ width: `${Math.max(logoProgress, 5)}%` }}
                  />
                </div>
                <p className="text-[10px] text-orange-700 text-center">
                  {language === 'ar' ? 'يتم الرفع المباشر إلى Firebase Cloud Storage...' : 'Uploading directly to Firebase Cloud Storage...'}
                </p>
              </div>
            )}

            {/* Saved Metadata Info */}
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
                  disabled={logoUploading}
                  className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-orange-600 hover:bg-orange-700 text-white text-xs font-bold shadow-md shadow-orange-600/20 transition cursor-pointer disabled:opacity-50"
                >
                  <Upload className="w-4 h-4" />
                  <span>
                    {logoUploading 
                      ? (language === 'ar' ? `جاري الرفع (${logoProgress}%)...` : `Uploading (${logoProgress}%)...`)
                      : (language === 'ar' ? 'تأكيد وحفظ الشعار' : 'Confirm & Upload Logo')}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setLogoFile(null);
                    if (logoPreviewUrl) URL.revokeObjectURL(logoPreviewUrl);
                    setLogoPreviewUrl(null);
                    setLogoError(null);
                  }}
                  disabled={logoUploading}
                  className="px-3.5 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold transition cursor-pointer disabled:opacity-50"
                >
                  {language === 'ar' ? 'إلغاء' : 'Cancel'}
                </button>
              </div>
            ) : logoError ? (
              <div className="flex items-center gap-2 w-full">
                <button
                  type="button"
                  onClick={() => logoInputRef.current?.click()}
                  className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-orange-600 hover:bg-orange-700 text-white text-xs font-bold transition cursor-pointer"
                >
                  <RotateCcw className="w-4 h-4" />
                  <span>{language === 'ar' ? 'إعادة المحاولة' : 'Retry Upload'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setLogoError(null)}
                  className="px-3.5 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold transition cursor-pointer"
                >
                  {language === 'ar' ? 'إغلاق' : 'Dismiss'}
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
                    disabled={logoUploading}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-rose-600 hover:bg-rose-50 text-xs font-semibold transition cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>{language === 'ar' ? 'حذف واستعادة الافتراضي' : 'Reset to Default'}</span>
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
            {/* Header */}
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

            {/* Developer Status Alerts */}
            {devSuccess && (
              <div className="mt-4 p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 flex items-start gap-2.5 text-xs">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="font-semibold">{devSuccess}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setDevSuccess(null)}
                  className="text-emerald-500 hover:text-emerald-700 p-0.5"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            {devError && (
              <div className="mt-4 p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 space-y-2 text-xs">
                <div className="flex items-start gap-2.5">
                  <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <p className="font-semibold">{devError.message}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setDevError(null)}
                    className="text-rose-500 hover:text-rose-700 p-0.5"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>

                {/* Technical Diagnostic for Super Admin */}
                {devError.code && (
                  <div className="pt-1 border-t border-rose-200/60">
                    <button
                      type="button"
                      onClick={() => setShowDevTechDetails(!showDevTechDetails)}
                      className="text-[11px] font-mono text-rose-700 hover:underline flex items-center gap-1"
                    >
                      <span>{language === 'ar' ? 'التفاصيل التقنية للخطأ:' : 'Technical Error Details:'} ({devError.code})</span>
                      {showDevTechDetails ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                    </button>
                    {showDevTechDetails && (
                      <pre className="mt-1.5 p-2 rounded bg-rose-100/70 font-mono text-[10px] text-rose-950 overflow-x-auto whitespace-pre-wrap">
                        {devError.raw || devError.message}
                      </pre>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Current Active or Pending Preview Box */}
            <div className="mt-4 p-4 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-center min-h-[160px]">
              {devPreviewUrl ? (
                <div className="flex flex-col items-center gap-2 w-full">
                  <span className="text-[10px] font-bold text-indigo-700 bg-indigo-100 px-2.5 py-0.5 rounded-full flex items-center gap-1">
                    <FileCheck className="w-3 h-3" />
                    {language === 'ar' ? 'معاينة الصورة المختارة (قبل الرفع)' : 'Selected Photo Preview (Pending Upload)'}
                  </span>
                  <div className="w-24 h-24 rounded-full overflow-hidden border-2 border-indigo-500 shadow-md">
                    <img
                      src={devPreviewUrl}
                      alt="Developer Preview"
                      className="w-full h-full object-cover"
                    />
                  </div>
                  <div className="flex items-center gap-3 text-[11px] text-slate-600 font-mono bg-white px-3 py-1 rounded-lg border border-slate-200 shadow-2xs">
                    <span>{devFile?.name}</span>
                    <span className="text-slate-300">|</span>
                    <span className="font-bold text-indigo-600">{formatBytes(devFile?.size)}</span>
                    <span className="text-slate-300">|</span>
                    <span className="text-slate-400">{devFile?.type || 'image/jpeg'}</span>
                  </div>
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
                      : (language === 'ar' ? 'صورة المطور الأصلية' : 'Default Asset')}
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
              className={`mt-4 p-5 rounded-2xl border-2 border-dashed transition cursor-pointer flex flex-col items-center justify-center text-center ${
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
              <Upload className="w-7 h-7 text-indigo-500 mb-1.5" />
              <p className="text-xs font-bold text-slate-800">
                {language === 'ar' ? 'انقر لاختيار صورة المطور أو اسحبها وأفلتها هنا' : 'Click to select developer photo or drag & drop here'}
              </p>
              <p className="text-[11px] text-slate-500 mt-0.5">
                {language === 'ar' ? 'PNG, JPG, JPEG, WEBP حتى 5 ميجابايت' : 'PNG, JPG, JPEG, WEBP up to 5MB'}
              </p>
            </div>

            {/* Real Progress Bar during upload */}
            {devUploading && (
              <div className="mt-4 p-3.5 rounded-xl bg-indigo-50/70 border border-indigo-200 space-y-2">
                <div className="flex items-center justify-between text-xs font-bold text-indigo-900">
                  <span className="flex items-center gap-1.5">
                    <RefreshCw className="w-3.5 h-3.5 animate-spin text-indigo-600" />
                    {language === 'ar' ? `جاري الرفع ${devProgress}%` : `Uploading ${devProgress}%`}
                  </span>
                  <span className="font-mono">{devProgress}%</span>
                </div>
                <div className="w-full h-2 rounded-full bg-indigo-200 overflow-hidden">
                  <div 
                    className="h-full bg-gradient-to-r from-indigo-500 to-purple-500 transition-all duration-300 rounded-full"
                    style={{ width: `${Math.max(devProgress, 5)}%` }}
                  />
                </div>
                <p className="text-[10px] text-indigo-700 text-center">
                  {language === 'ar' ? 'يتم الرفع المباشر إلى Firebase Cloud Storage...' : 'Uploading directly to Firebase Cloud Storage...'}
                </p>
              </div>
            )}

            {/* Saved Metadata Info */}
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
                  disabled={devUploading}
                  className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold shadow-md shadow-indigo-600/20 transition cursor-pointer disabled:opacity-50"
                >
                  <Upload className="w-4 h-4" />
                  <span>
                    {devUploading 
                      ? (language === 'ar' ? `جاري الرفع (${devProgress}%)...` : `Uploading (${devProgress}%)...`)
                      : (language === 'ar' ? 'تأكيد وحفظ الصورة' : 'Confirm & Upload Photo')}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setDevFile(null);
                    if (devPreviewUrl) URL.revokeObjectURL(devPreviewUrl);
                    setDevPreviewUrl(null);
                    setDevError(null);
                  }}
                  disabled={devUploading}
                  className="px-3.5 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold transition cursor-pointer disabled:opacity-50"
                >
                  {language === 'ar' ? 'إلغاء' : 'Cancel'}
                </button>
              </div>
            ) : devError ? (
              <div className="flex items-center gap-2 w-full">
                <button
                  type="button"
                  onClick={() => devInputRef.current?.click()}
                  className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold transition cursor-pointer"
                >
                  <RotateCcw className="w-4 h-4" />
                  <span>{language === 'ar' ? 'إعادة المحاولة' : 'Retry Upload'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setDevError(null)}
                  className="px-3.5 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold transition cursor-pointer"
                >
                  {language === 'ar' ? 'إغلاق' : 'Dismiss'}
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
                    disabled={devUploading}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-rose-600 hover:bg-rose-50 text-xs font-semibold transition cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>{language === 'ar' ? 'حذف واستعادة الافتراضي' : 'Reset to Default'}</span>
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

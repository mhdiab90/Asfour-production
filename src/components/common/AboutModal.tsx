/**
 * About System & Architecture Information Modal
 * Displays ASFOUR Factory ERP overview, system versions, cloud architecture, and developer identity.
 */
import React from 'react';
import { 
  ShieldCheck, 
  Info, 
  Cpu, 
  Database, 
  Cloud, 
  Github, 
  Globe, 
  Terminal, 
  CheckCircle2,
  X,
  ExternalLink,
  GitBranch,
  Flame,
  Award
} from 'lucide-react';
import { AsfourLogo } from './AsfourLogo';
import { DeveloperBadge } from './DeveloperBadge';
import { CURRENT_APP_VERSION, DATABASE_SCHEMA_VERSION } from '../../config/appVersion';
import { useLanguage } from '../../i18n/LanguageContext';

interface AboutModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const AboutModal: React.FC<AboutModalProps> = ({ isOpen, onClose }) => {
  const { isRtl, t, language } = useLanguage();

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-xs select-none">
      <div 
        className="bg-slate-900 border border-slate-700/80 rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-2xl text-white flex flex-col"
        dir={isRtl ? 'rtl' : 'ltr'}
      >
        {/* Modal Header */}
        <div className="p-6 border-b border-slate-800 flex items-center justify-between sticky top-0 bg-slate-900/95 backdrop-blur-md z-10">
          <div className="flex items-center gap-3">
            <AsfourLogo variant="icon" size="sm" />
            <div>
              <h3 className="text-base font-bold text-white tracking-wide">
                {t('about_title')}
              </h3>
              <p className="text-xs text-slate-400">
                {language === 'ar' ? 'معلومات المنظومة والترقية السحابية' : 'System Architecture & Release Notes'}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-white hover:bg-slate-800 transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Content */}
        <div className="p-6 space-y-6">
          {/* Company Brand Banner */}
          <div className="p-4 rounded-2xl bg-gradient-to-r from-slate-950 via-slate-900 to-indigo-950/60 border border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-4">
            <AsfourLogo variant="full" size="md" subtitleLang={language} />
            <div className="text-center sm:text-left font-mono text-xs text-slate-400 space-y-1">
              <div className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded-full font-bold">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                <span>Cloud Production Operational</span>
              </div>
              <p className="text-[11px]">Factory ISO Standard: TON Metric</p>
            </div>
          </div>

          {/* System Version & Infrastructure Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
            <div className="p-3.5 rounded-xl bg-slate-950/80 border border-slate-800 space-y-1.5">
              <div className="flex items-center gap-2 text-indigo-400 font-bold">
                <GitBranch className="w-4 h-4" />
                <span>{t('about_version')}:</span>
              </div>
              <p className="text-white font-mono text-sm font-black">
                v{CURRENT_APP_VERSION.version} ({CURRENT_APP_VERSION.environment})
              </p>
              <p className="text-[11px] text-slate-400 font-mono">
                Build: {CURRENT_APP_VERSION.buildId} &bull; {CURRENT_APP_VERSION.releaseDate}
              </p>
            </div>

            <div className="p-3.5 rounded-xl bg-slate-950/80 border border-slate-800 space-y-1.5">
              <div className="flex items-center gap-2 text-amber-400 font-bold">
                <Database className="w-4 h-4" />
                <span>{t('about_schema')}:</span>
              </div>
              <p className="text-white font-mono text-sm font-black">
                Schema v{DATABASE_SCHEMA_VERSION}
              </p>
              <p className="text-[11px] text-slate-400 font-mono">
                8 Production Stages &bull; TON Primary Metric
              </p>
            </div>

            <div className="p-3.5 rounded-xl bg-slate-950/80 border border-slate-800 space-y-1.5">
              <div className="flex items-center gap-2 text-sky-400 font-bold">
                <Cloud className="w-4 h-4" />
                <span>{t('about_firebase_project')}:</span>
              </div>
              <p className="text-white font-mono text-xs font-bold">
                asfourproduction-70e6e
              </p>
              <p className="text-[11px] text-slate-400 font-mono">
                Firestore Cloud Database &bull; Firebase Auth
              </p>
            </div>

            <div className="p-3.5 rounded-xl bg-slate-950/80 border border-slate-800 space-y-1.5">
              <div className="flex items-center gap-2 text-purple-400 font-bold">
                <Globe className="w-4 h-4" />
                <span>{t('about_cloudflare_site')}:</span>
              </div>
              <a
                href="https://asfour-production.pages.dev"
                target="_blank"
                rel="noreferrer"
                className="text-indigo-400 hover:text-indigo-300 font-mono text-xs flex items-center gap-1 font-bold truncate"
              >
                <span>asfour-production.pages.dev</span>
                <ExternalLink className="w-3 h-3 shrink-0" />
              </a>
              <p className="text-[11px] text-slate-400 font-mono">
                Cloudflare Edge Deployment
              </p>
            </div>
          </div>

          {/* Developer Recognition Card */}
          <div>
            <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2 flex items-center gap-2">
              <Award className="w-4 h-4 text-amber-400" />
              <span>{t('about_developer_title')}</span>
            </h4>
            <DeveloperBadge variant="about" />
          </div>

          {/* Compliance & Standards Note */}
          <div className="p-4 rounded-xl bg-slate-950 border border-slate-800/80 text-xs text-slate-400 space-y-2">
            <div className="flex items-center gap-2 text-slate-300 font-bold">
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
              <span>{language === 'ar' ? 'معايير التشغيل وضمان استمرارية البيانات:' : 'Factory Operational Standards & Compliance:'}</span>
            </div>
            <ul className="list-disc list-inside space-y-1 text-[11px] leading-relaxed">
              <li>{language === 'ar' ? 'اعتماد وحدة الطن (TON) كوحدة قياس قياسية أولية لحسابات الإنتاج والأوزان والهالك.' : 'Standardized TON as primary factory unit for production, good output, and scrap calculations.'}</li>
              <li>{language === 'ar' ? 'الحفاظ التام على قاعدة البيانات الأصلية وسجلات الإنتاج السابقة دون فقدان أو تعديل هيكلي قسري.' : 'Preserved existing Firestore production data and schema compatibility.'}</li>
              <li>{language === 'ar' ? 'دعم كامل للأجهزة اللوحية وأجهزة فنيي التشغيل في صالة الإنتاج.' : 'Full responsive mobile and touch screen support for factory floor tablets.'}</li>
            </ul>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="p-4 border-t border-slate-800 bg-slate-950/60 flex items-center justify-between">
          <span className="text-[11px] font-mono text-slate-500">
            ASFOUR Refractories ERP &bull; 2026
          </span>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs transition cursor-pointer shadow-sm"
          >
            {t('close')}
          </button>
        </div>
      </div>
    </div>
  );
};

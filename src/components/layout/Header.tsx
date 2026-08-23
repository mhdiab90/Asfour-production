import React, { useState } from 'react';
import { 
  Menu, 
  LogOut, 
  Plus, 
  ShieldCheck,
  Cpu,
  Info,
  Layers,
  Sparkles
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { ConnectionStatusBadge } from '../common/ConnectionStatusBadge';
import { NavigationPage } from '../../types';
import { useLanguage } from '../../i18n/LanguageContext';
import { LanguageSwitcher } from '../common/LanguageSwitcher';
import { AsfourLogo } from '../common/AsfourLogo';
import { AboutModal } from '../common/AboutModal';

interface HeaderProps {
  currentPage: NavigationPage;
  onNavigate: (page: NavigationPage) => void;
  onOpenMobileMenu: () => void;
  onOpenProfile: () => void;
  connectionStatus: 'online' | 'offline' | 'syncing';
  onCheckConnection: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  currentPage,
  onNavigate,
  onOpenMobileMenu,
  onOpenProfile,
  connectionStatus,
  onCheckConnection,
}) => {
  const { adminUser, logout, isSuperAdmin, isProductionUser, hasPermission } = useAuth();
  const { language, isRtl, t } = useLanguage();
  const [isAboutModalOpen, setIsAboutModalOpen] = useState(false);

  const getPageDetails = (page: NavigationPage) => {
    switch (page) {
      case 'dashboard':
        return {
          title: language === 'ar' ? 'لوحة التحكم الشاملة' : 'Factory Master Dashboard',
          subtitle: language === 'ar' ? 'مراقبة خطوط الإنتاج والحراريات ومؤشرات الأطنان' : 'Live production line monitoring & Ton metrics',
        };
      case 'production':
      case 'production-entry':
        return {
          title: language === 'ar' ? 'تسجيل عملية إنتاج جديدة (8 مراحل)' : 'New Production Entry (8 Stages)',
          subtitle: language === 'ar' ? 'إدخال بيانات الوردية، المكبس، وحساب الأوزان والهالك بالأطنان' : 'Shift entry, press selection, and Ton weight calculations',
        };
      case 'production-records':
        return {
          title: language === 'ar' ? 'سجلات وعمليات الإنتاج' : 'Production Records Directory',
          subtitle: language === 'ar' ? 'استعراض وبحث وتعديل سجلات الإنتاج اليومية' : 'Search, filter, and inspect daily production entries',
        };
      case 'data-review':
        return {
          title: language === 'ar' ? 'مراجعة وتدقيق واعتماد السجلات' : 'Audit, Review & Approval',
          subtitle: language === 'ar' ? 'مراجعة دورة حياة السجل وسجل التعديلات التاريخي' : 'Workflow audit lifecycle and verified record approvals',
        };
      case 'historical-import':
      case 'bulk-entry':
        return {
          title: language === 'ar' ? 'مركز استيراد الإنتاج التاريخي' : 'Historical Excel Import Center',
          subtitle: language === 'ar' ? 'استيراد سجلات الإكسل مع الربط التلقائي والتحقق' : 'Import Excel workbooks with smart code verification',
        };
      case 'backup-restore':
      case 'backups':
        return {
          title: language === 'ar' ? 'مركز النسخ الاحتياطي لقاعدة البيانات' : 'Disaster Recovery & Backup Center',
          subtitle: language === 'ar' ? 'إنشاء وتنزيل النسخ الاحتياطية ومراقبة سلامة البيانات' : 'Create snapshots, download JSON backups, and monitor data safety',
        };
      case 'restore':
        return {
          title: language === 'ar' ? 'مركز استعادة البيانات الآمن' : 'Safe Data Restore Center',
          subtitle: language === 'ar' ? 'معاينة الفروق، نقاط الأمان، واستعادة البيانات بدقة' : 'Diff previews, safety checkpoints, and verified restoration',
        };
      case 'system-health':
        return {
          title: language === 'ar' ? 'صحة النظام وجودة الاتصال السحابي' : 'System Health & Cloud Latency',
          subtitle: language === 'ar' ? 'مراقبة زمن استجابة Firestore، جلسات Firebase Auth، وبروتوكولات الأمان' : 'Monitor Firestore latency, Firebase Auth sessions, and security',
        };
      case 'versions':
        return {
          title: language === 'ar' ? 'سجل إصدارات وتحديثات المنظومة' : 'Versions & Deployment Changelog',
          subtitle: language === 'ar' ? 'الإصدار الحالي، أرقام البناء، وتاريخ الترقيات' : 'Active version, build timestamp, and schema upgrades',
        };
      case 'raw-materials':
        return {
          title: language === 'ar' ? 'إدارة الخامات الأولية والمخزون' : 'Raw Materials & Stock Management',
          subtitle: language === 'ar' ? 'تتبع كميات الخامات ومستويات إعادة الطلب' : 'Track mineral stock, chamotte consumption, and reorder levels',
        };
      case 'ai-assistant':
        return {
          title: language === 'ar' ? 'المساعد الذكي وتحليلات المصنع' : 'AI Factory Assistant',
          subtitle: language === 'ar' ? 'استفسارات اللغة الطبيعية وتحليل الأداء والأعطال' : 'Natural language plant analytics, downtime patterns, and insights',
        };
      case 'master-data':
        return {
          title: language === 'ar' ? 'البيانات الأساسية للمصنع' : 'Factory Master Data',
          subtitle: language === 'ar' ? 'العمال، المكابس، الأفران، عربات الأفران، والمنتجات' : 'Employees, presses, furnaces, cars, and products catalog',
        };
      case 'user-management':
        return {
          title: language === 'ar' ? 'إدارة المستخدمين والصلاحيات الدقيقة' : 'Users & Granular Permissions',
          subtitle: language === 'ar' ? 'إنشاء الحسابات، قوالب الصلاحيات، والتحكم بحقوق الوصول' : 'Manage accounts, role presets, and granular access rights',
        };
      case 'reports':
        return {
          title: language === 'ar' ? 'التقارير التحليلية المتقدمة' : 'Advanced Analytical Reports',
          subtitle: language === 'ar' ? 'تحليل الأداء حسب المكبس والفرن والمنتج والوردية' : 'Performance breakdowns by press, furnace, product, and shift',
        };
      case 'settings':
        return {
          title: language === 'ar' ? 'إعدادات النظام وسجل التدقيق' : 'System Settings & Audit Trail',
          subtitle: language === 'ar' ? 'فحص الاتصال السحابي وسجلات النشاط' : 'Security logs, cloud config, and audit trail',
        };
      default:
        return {
          title: language === 'ar' ? 'نظام إدارة مصنع عصفور' : 'ASFOUR Factory Management ERP',
          subtitle: 'ASFOUR For Mining & Refractories',
        };
    }
  };

  const currentInfo = getPageDetails(currentPage);

  return (
    <>
      <header className="h-16 bg-white border-b border-slate-200 flex items-center justify-between px-4 sm:px-6 sticky top-0 z-30 shadow-xs" dir={isRtl ? 'rtl' : 'ltr'}>
        {/* Leading Side: Mobile Trigger & Page Title */}
        <div className="flex items-center gap-3 sm:gap-4 min-w-0">
          <button
            id="mobile-menu-toggle-btn"
            type="button"
            onClick={onOpenMobileMenu}
            className="lg:hidden w-9 h-9 rounded-lg flex items-center justify-center text-slate-600 hover:text-slate-900 hover:bg-slate-100 cursor-pointer shrink-0 border border-slate-200"
            title="القائمة / Menu"
          >
            <Menu className="w-5 h-5" />
          </button>

          <div className="min-w-0">
            <h1 className="text-sm sm:text-base font-black text-slate-900 tracking-tight flex items-center gap-2 truncate">
              <span className="truncate">{currentInfo.title}</span>
              {isProductionUser && (
                <span className="hidden md:inline-flex items-center gap-1 text-[10px] px-2 py-0.5 bg-amber-50 text-amber-800 border border-amber-300 rounded-full font-bold shrink-0">
                  <Cpu className="w-3 h-3" />
                  <span>{language === 'ar' ? 'شاشة المشغل' : 'Operator Portal'}</span>
                </span>
              )}
            </h1>
            <span className="hidden md:block text-xs text-slate-500 truncate">
              {currentInfo.subtitle}
            </span>
          </div>
        </div>

        {/* Trailing Side: Actions, Language Switcher, Connection & Profile */}
        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          {/* Language Switcher */}
          <LanguageSwitcher variant="compact" />

          {/* About / Info Button */}
          <button
            type="button"
            onClick={() => setIsAboutModalOpen(true)}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 border border-slate-200 transition cursor-pointer"
            title={language === 'ar' ? 'عن المنظومة والمطور' : 'About System & Developer'}
          >
            <Info className="w-4 h-4" />
          </button>

          {/* Cloud Connection Badge */}
          <ConnectionStatusBadge
            status={connectionStatus}
            onClick={onCheckConnection}
          />

          {/* Quick Add Button */}
          {currentPage !== 'production-entry' && hasPermission('production.create') && (
            <button
              id="header-quick-add-btn"
              type="button"
              onClick={() => onNavigate('production-entry')}
              className={`px-3 py-1.5 text-xs sm:text-sm font-bold rounded-lg border transition-colors cursor-pointer flex items-center gap-1.5 shadow-xs ${
                isProductionUser
                  ? 'bg-amber-500 text-slate-950 hover:bg-amber-400 border-amber-600'
                  : 'bg-indigo-600 text-white hover:bg-indigo-500 border-indigo-700'
              }`}
            >
              <Plus className="w-4 h-4" />
              <span className="hidden sm:inline">{language === 'ar' ? 'تسجيل إنتاج +' : 'New Entry +'}</span>
            </button>
          )}

          {/* User Profile & Logout */}
          <div className="flex items-center gap-1.5 pl-1.5 border-slate-200 border-x">
            <button
              id="user-profile-btn"
              type="button"
              onClick={onOpenProfile}
              className="flex items-center gap-2 p-1 rounded-lg hover:bg-slate-100 cursor-pointer"
              title={language === 'ar' ? 'الملف الشخصي' : 'User Profile'}
            >
              <div className={`w-8 h-8 rounded-full ${isProductionUser ? 'bg-amber-500 text-slate-950 font-black' : 'bg-slate-900 text-white font-bold'} flex items-center justify-center text-xs shadow-xs`}>
                {adminUser?.username?.charAt(0).toUpperCase() || 'A'}
              </div>
              <div className="hidden xl:block text-start leading-tight">
                <p className="text-xs font-bold text-slate-800 truncate max-w-[120px]">
                  {adminUser?.fullName || adminUser?.username || 'مشغل خط الإنتاج'}
                </p>
                <p className={`text-[10px] ${isProductionUser ? 'text-amber-600' : 'text-indigo-600'} font-bold uppercase truncate`}>
                  {adminUser?.role || 'USER'}
                </p>
              </div>
            </button>

            <button
              id="header-logout-btn"
              type="button"
              onClick={() => logout()}
              title={language === 'ar' ? 'تسجيل الخروج' : 'Sign Out'}
              className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      {/* About System Modal */}
      <AboutModal
        isOpen={isAboutModalOpen}
        onClose={() => setIsAboutModalOpen(false)}
      />
    </>
  );
};

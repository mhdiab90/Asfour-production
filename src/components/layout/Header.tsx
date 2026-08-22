import React from 'react';
import { 
  Menu, 
  LogOut, 
  Plus, 
  ShieldCheck,
  Cpu
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { ConnectionStatusBadge } from '../common/ConnectionStatusBadge';
import { NavigationPage } from '../../types';

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
  const { adminUser, logout, isSuperAdmin, isProductionUser } = useAuth();

  const pageTitles: Record<NavigationPage, { title: string; subtitle: string }> = {
    'dashboard': { title: 'لوحة التحكم الشاملة', subtitle: 'مراقبة خطوط الإنتاج والحراريات مباشرة' },
    'production': { title: 'تسجيل عملية إنتاج جديدة (8 مراحل)', subtitle: 'إدخال بيانات الوردية، المكبس، وحساب الأوزان والهالك' },
    'production-entry': { title: 'تسجيل عملية إنتاج جديدة (8 مراحل)', subtitle: 'إدخال بيانات الوردية، المكبس، وحساب الأوزان والهالك' },
    'production-records': { title: 'سجلات وعمليات الإنتاج', subtitle: 'استعراض وبحث وتعديل سجلات الإنتاج اليومية' },
    'data-review': { title: 'مراجعة وتدقيق واعتماد السجلات', subtitle: 'مراجعة دورة حياة السجل وسجل التعديلات التاريخي' },
    'historical-import': { title: 'مركز استيراد الإنتاج التاريخي', subtitle: 'استيراد سجلات الإكسل للمراحل مع الربط التلقائي والتحقق' },
    'backup-restore': { title: 'مركز النسخ الاحتياطي والاستعادة الشامل', subtitle: 'إدارة النسخ الاحتياطية وحماية البيانات واستعادتها بأمان' },
    'backups': { title: 'مركز النسخ الاحتياطي لقاعدة البيانات', subtitle: 'إنشاء وتنزيل النسخ الاحتياطية ومراقبة سلامة البيانات' },
    'restore': { title: 'مركز استعادة البيانات الآمن', subtitle: 'معاينة الفروق، نقاط الأمان، واستعادة البيانات بدقة' },
    'system-health': { title: 'صحة النظام وجودة الاتصال السحابي', subtitle: 'مراقبة زمن استجابة Firestore، جلسات Firebase Auth، وبروتوكولات الطوارئ' },
    'versions': { title: 'سجل إصدارات وتحديثات المنظومة', subtitle: 'الإصدار الحالي، أرقام البناء، وتاريخ الترقيات وسجل التعديلات' },
    'raw-materials': { title: 'إدارة الخامات الأولية والمخزون', subtitle: 'تتبع كميات الخامات ومستويات إعادة الطلب' },
    'ai-assistant': { title: 'المساعد الذكي وتحليلات المصنع', subtitle: 'استفسارات اللغة الطبيعية وتحليل الأداء والأعطال' },
    'material-traceability': { title: 'تتبع استهلاك المواد والخامات', subtitle: 'ربط الخامات بدفعات الإنتاج والأفران' },
    'data-quality': { title: 'جودة البيانات ومطابقة الأكواد', subtitle: 'فحص الحقول المفقودة والتكرارات' },
    'master-data': { title: 'إدارة البيانات الأساسية', subtitle: 'العمال، المكابس، الأفران، عربات الأفران، والمنتجات' },
    'user-management': { title: 'إدارة مستخدمي النظام والصلاحيات', subtitle: 'إنشاء حسابات المشغلين (PRODUCTION_USER) وربطها بسجلات العمال' },
    'bulk-entry': { title: 'الاستيراد المجمع للبيانات', subtitle: 'استيراد ملفات Excel و CSV مع التحقق الفوري' },
    'reports': { title: 'التقارير التحليلية المتقدمة', subtitle: 'تحليل الأداء حسب المكبس والفرن والمنتج والوردية' },
    'settings': { title: 'إعدادات النظام وسجل التدقيق', subtitle: 'فحص الاتصال السحابي وسجلات النشاط' },
    'admin-panel': { title: 'لوحة إدارة النظام', subtitle: 'صلاحيات المشرف العام' },
  };

  const currentInfo = pageTitles[currentPage] || { title: 'نظام إدارة مصنع عصفور', subtitle: 'ASFOUR ERP' };

  return (
    <header className="h-16 bg-white border-b border-slate-200 flex items-center justify-between px-4 sm:px-8 sticky top-0 z-30 shadow-xs" dir="rtl">
      {/* Right side in RTL: Title & Vertical Divider */}
      <div className="flex items-center gap-3 sm:gap-4">
        <button
          id="mobile-menu-toggle-btn"
          type="button"
          onClick={onOpenMobileMenu}
          className="lg:hidden w-8 h-8 rounded flex items-center justify-center text-slate-600 hover:text-slate-900 hover:bg-slate-100 cursor-pointer"
        >
          <Menu className="w-5 h-5" />
        </button>

        <div>
          <h1 className="text-base sm:text-lg font-bold text-slate-800 tracking-tight flex items-center gap-2">
            <span>{currentInfo.title}</span>
            {isProductionUser && (
              <span className="hidden sm:inline-flex items-center gap-1 text-[11px] px-2 py-0.5 bg-amber-50 text-amber-700 border border-amber-200 rounded-full font-bold">
                <Cpu className="w-3 h-3" />
                <span>شاشة المشغل</span>
              </span>
            )}
          </h1>
          <span className="hidden md:block text-xs text-slate-500">
            {currentInfo.subtitle}
          </span>
        </div>
      </div>

      {/* Left side in RTL: Actions, Connection Status & Profile */}
      <div className="flex items-center gap-3">
        <ConnectionStatusBadge
          status={connectionStatus}
          onClick={onCheckConnection}
        />

        {currentPage !== 'production-entry' && (
          <button
            id="header-quick-add-btn"
            type="button"
            onClick={() => onNavigate('production-entry')}
            className={`px-3.5 py-1.5 text-xs sm:text-sm font-bold rounded-lg border transition-colors cursor-pointer flex items-center gap-1.5 ${
              isProductionUser
                ? 'bg-amber-500 text-slate-950 hover:bg-amber-400 border-amber-600 shadow-xs'
                : 'bg-indigo-50 text-indigo-700 hover:bg-indigo-100 border-indigo-200'
            }`}
          >
            <Plus className="w-4 h-4" />
            <span>تسجيل إنتاج +</span>
          </button>
        )}

        <div className="flex items-center gap-2 pr-2 border-r border-slate-200">
          <button
            id="user-profile-btn"
            type="button"
            onClick={onOpenProfile}
            className="flex items-center gap-2 p-1 rounded-lg hover:bg-slate-100 text-right cursor-pointer"
            title="الملف الشخصي"
          >
            <div className={`w-8 h-8 rounded-full ${isProductionUser ? 'bg-amber-500 text-slate-950 font-black' : 'bg-slate-800 text-white font-bold'} flex items-center justify-center text-xs shadow-xs`}>
              {adminUser?.username?.charAt(0).toUpperCase() || 'A'}
            </div>
            <div className="hidden xl:block text-right">
              <p className="text-xs font-bold text-slate-800 leading-tight">
                {adminUser?.fullName || adminUser?.username || 'مشغل خط الإنتاج'}
              </p>
              <p className={`text-[10px] ${isProductionUser ? 'text-amber-600' : 'text-indigo-600'} font-bold uppercase leading-tight`}>
                {isProductionUser ? 'مشغل إنتاج / فني' : 'مدير النظام الرئيسي'}
              </p>
            </div>
          </button>

          <button
            id="header-logout-btn"
            type="button"
            onClick={() => logout()}
            title="تسجيل الخروج"
            className="w-8 h-8 rounded flex items-center justify-center text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>
    </header>
  );
};

import React from 'react';
import { 
  LayoutDashboard, 
  PlusCircle, 
  FileText, 
  Database, 
  UploadCloud, 
  BarChart3, 
  Settings, 
  ShieldCheck, 
  LogOut, 
  Factory, 
  ChevronLeft,
  Cpu,
  Users,
  Sparkles,
  Package,
  FileSpreadsheet,
  RotateCcw,
  Activity
} from 'lucide-react';
import { NavigationPage } from '../../types';
import { useAuth } from '../../context/AuthContext';
import { useUpdate } from '../../context/UpdateContext';
import { CURRENT_APP_VERSION } from '../../config/appVersion';

interface SidebarProps {
  currentPage: NavigationPage;
  onNavigate: (page: NavigationPage) => void;
  isOpenMobile: boolean;
  onCloseMobile: () => void;
  onOpenProfile: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  currentPage,
  onNavigate,
  isOpenMobile,
  onCloseMobile,
  onOpenProfile,
}) => {
  const { logout, adminUser, isSuperAdmin, isProductionUser } = useAuth();
  const { setShowVersionModal, hasUpdate } = useUpdate();

  const operatorNavigation = [
    { id: 'production-entry' as NavigationPage, label: 'إدخال الإنتاج اليومي (المراحل)', icon: PlusCircle },
    { id: 'production-records' as NavigationPage, label: 'سجلات الإنتاج', icon: FileText },
    { id: 'data-review' as NavigationPage, label: 'مراجعة وتدقيق السجلات', icon: ShieldCheck },
  ];

  const mainNavigation = [
    { id: 'dashboard' as NavigationPage, label: 'لوحة التحكم', icon: LayoutDashboard },
    { id: 'production-entry' as NavigationPage, label: 'تسجيل الإنتاج (8 مراحل)', icon: PlusCircle },
    { id: 'production-records' as NavigationPage, label: 'سجلات الإنتاج', icon: FileText },
    { id: 'data-review' as NavigationPage, label: 'التدقيق والاعتماد', icon: ShieldCheck, badge: 'جديد' },
    { id: 'ai-assistant' as NavigationPage, label: 'المساعد الذكي للتحليل', icon: Sparkles, badge: 'AI' },
  ];

  const adminNavigation = [
    { id: 'raw-materials' as NavigationPage, label: 'الخامات والمخزون', icon: Package },
    { id: 'master-data' as NavigationPage, label: 'البيانات الأساسية', icon: Database },
    { id: 'historical-import' as NavigationPage, label: 'استيراد الإنتاج التاريخي', icon: FileSpreadsheet, badge: 'Excel' },
    { id: 'backup-restore' as NavigationPage, label: 'النسخ الاحتياطي والاستعادة', icon: RotateCcw, badge: 'آمن' },
    { id: 'system-health' as NavigationPage, label: 'صحة النظام والإصدارات', icon: Activity },
    { id: 'user-management' as NavigationPage, label: 'إدارة المستخدمين', icon: Users },
    { id: 'reports' as NavigationPage, label: 'التقارير والإحصائيات', icon: BarChart3 },
    { id: 'settings' as NavigationPage, label: 'سجلات النظام والربط', icon: Settings },
  ];

  const handleSelectPage = (page: NavigationPage) => {
    onNavigate(page);
    onCloseMobile();
  };

  return (
    <>
      {/* Mobile Backdrop */}
      {isOpenMobile && (
        <div
          className="fixed inset-0 bg-slate-950/70 backdrop-blur-xs z-40 lg:hidden"
          onClick={onCloseMobile}
        />
      )}

      {/* Geometric Balance Sidebar Container */}
      <aside
        className={`fixed top-0 bottom-0 right-0 z-50 w-64 bg-slate-900 text-slate-200 flex flex-col h-full border-l border-slate-700 shadow-2xl transition-transform duration-300 ease-in-out lg:translate-x-0 ${
          isOpenMobile ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        {/* Brand Header */}
        <div className="p-6 border-b border-slate-800">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className={`w-8 h-8 ${isProductionUser ? 'bg-amber-500 text-slate-950' : 'bg-indigo-500 text-white'} rounded-sm flex items-center justify-center font-bold shadow-sm`}>
                A
              </div>
              <div>
                <span className="text-lg font-bold tracking-tight text-white uppercase block leading-tight">
                  ASFOUR ERP
                </span>
                <p className="text-[10px] text-slate-400 uppercase tracking-widest leading-none mt-0.5">
                  {isProductionUser ? 'بوابة مشغلي الإنتاج' : 'Factory Management'}
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={onCloseMobile}
              className="lg:hidden w-7 h-7 rounded flex items-center justify-center text-slate-400 hover:text-white hover:bg-slate-800"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Navigation List */}
        <nav className="flex-grow py-4 overflow-y-auto space-y-4">
          {/* Operator Mode Navigation */}
          {isProductionUser ? (
            <div>
              <div className="px-6 mb-2 text-[11px] text-amber-400 font-bold uppercase tracking-wider flex items-center gap-1.5">
                <Cpu className="w-3.5 h-3.5" />
                <span>مهام خط الإنتاج</span>
              </div>
              <div className="space-y-0.5">
                {operatorNavigation.map((item) => {
                  const Icon = item.icon;
                  const isActive = currentPage === item.id;
                  return (
                    <button
                      key={item.id}
                      id={`nav-item-${item.id}`}
                      type="button"
                      onClick={() => handleSelectPage(item.id)}
                      className={`w-full flex items-center justify-between px-6 py-3 text-sm font-semibold transition-colors duration-150 cursor-pointer text-right ${
                        isActive
                          ? 'bg-amber-500 text-slate-950 border-r-4 border-amber-300 font-bold shadow-sm'
                          : 'text-slate-400 hover:bg-slate-800 hover:text-white'
                      }`}
                    >
                      <div className="flex items-center">
                        <Icon className="w-4 h-4 ml-3 shrink-0" />
                        <span>{item.label}</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : (
            <>
              {/* Admin Main Section */}
              <div>
                <div className="px-6 mb-2 text-[11px] text-slate-400 font-bold uppercase tracking-wider">
                  الرئيسية
                </div>
                <div className="space-y-0.5">
                  {mainNavigation.map((item) => {
                    const Icon = item.icon;
                    const isActive = currentPage === item.id;
                    return (
                      <button
                        key={item.id}
                        id={`nav-item-${item.id}`}
                        type="button"
                        onClick={() => handleSelectPage(item.id)}
                        className={`w-full flex items-center justify-between px-6 py-3 text-sm font-semibold transition-colors duration-150 cursor-pointer text-right ${
                          isActive
                            ? 'bg-indigo-600 text-white border-r-4 border-indigo-400 font-bold'
                            : 'text-slate-400 hover:bg-slate-800 hover:text-white'
                        }`}
                      >
                        <div className="flex items-center">
                          <Icon className="w-4 h-4 ml-3 shrink-0" />
                          <span>{item.label}</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Admin Section */}
              <div>
                <div className="px-6 mb-2 text-[11px] text-slate-400 font-bold uppercase tracking-wider">
                  الإدارة والتحليل
                </div>
                <div className="space-y-0.5">
                  {adminNavigation.map((item) => {
                    const Icon = item.icon;
                    const isActive = currentPage === item.id;
                    return (
                      <button
                        key={item.id}
                        id={`nav-item-${item.id}`}
                        type="button"
                        onClick={() => handleSelectPage(item.id)}
                        className={`w-full flex items-center justify-between px-6 py-3 text-sm font-semibold transition-colors duration-150 cursor-pointer text-right ${
                          isActive
                            ? 'bg-indigo-600 text-white border-r-4 border-indigo-400 font-bold'
                            : 'text-slate-400 hover:bg-slate-800 hover:text-white'
                        }`}
                      >
                        <div className="flex items-center">
                          <Icon className="w-4 h-4 ml-3 shrink-0" />
                          <span>{item.label}</span>
                        </div>
                        {item.badge && !isActive && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700 font-mono">
                            {item.badge}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            </>
          )}
        </nav>

        {/* Version & Changelog Trigger Pill */}
        <div className="px-4 py-2 bg-slate-950/60 border-t border-slate-800/80">
          <button
            onClick={() => setShowVersionModal(true)}
            className="w-full flex items-center justify-between px-3 py-1.5 rounded-xl bg-slate-800/50 hover:bg-slate-800 border border-slate-700/50 text-xs transition group"
          >
            <div className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${hasUpdate ? 'bg-amber-400 animate-ping' : 'bg-emerald-400'}`} />
              <span className="font-mono text-slate-300 font-bold group-hover:text-white">
                v{CURRENT_APP_VERSION.version}
              </span>
            </div>
            <span className="text-[10px] text-slate-400 font-mono">
              {hasUpdate ? 'تحديث متاح' : 'Schema v3'}
            </span>
          </button>
        </div>

        {/* User Profile & Logout Section in Footer */}
        <div className="p-4 border-t border-slate-800 bg-slate-950/40">
          <div className="flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={onOpenProfile}
              className="flex items-center gap-3 text-right flex-1 hover:opacity-90 transition-opacity"
            >
              <div className={`w-9 h-9 rounded-full ${isProductionUser ? 'bg-amber-500 text-slate-950 font-black' : 'bg-slate-700 text-white font-bold'} border border-slate-600 flex items-center justify-center text-sm shrink-0`}>
                {adminUser?.username?.charAt(0).toUpperCase() || 'A'}
              </div>
              <div className="flex flex-col truncate">
                <span className="text-sm font-medium text-white truncate">
                  {adminUser?.fullName || adminUser?.username || 'مشغل خط الإنتاج'}
                </span>
                <span className={`text-[10px] ${isProductionUser ? 'text-amber-400' : 'text-indigo-400'} font-bold uppercase tracking-wider truncate`}>
                  {isProductionUser ? 'PRODUCTION_USER' : 'SUPER_ADMIN'}
                </span>
              </div>
            </button>

            <button
              id="sidebar-logout-btn"
              type="button"
              onClick={() => logout()}
              title="تسجيل الخروج"
              className="w-8 h-8 rounded flex items-center justify-center text-slate-400 hover:text-rose-400 hover:bg-slate-800 transition-colors shrink-0"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </aside>
    </>
  );
};

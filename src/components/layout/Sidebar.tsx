import React, { useState } from 'react';
import { 
  LayoutDashboard, 
  PlusCircle, 
  FileText, 
  Database, 
  BarChart3, 
  Settings, 
  ShieldCheck, 
  LogOut, 
  ChevronLeft,
  ChevronRight,
  Cpu,
  Users,
  Sparkles,
  Package,
  FileSpreadsheet,
  RotateCcw,
  Activity,
  HardDrive,
  GitBranch,
  Info,
  Layers,
  Award,
  Image as ImageIcon
} from 'lucide-react';
import { NavigationPage } from '../../types';
import { useAuth } from '../../context/AuthContext';
import { useUpdate } from '../../context/UpdateContext';
import { CURRENT_APP_VERSION } from '../../config/appVersion';
import { useLanguage } from '../../i18n/LanguageContext';
import { AsfourLogo } from '../common/AsfourLogo';
import { DeveloperBadge } from '../common/DeveloperBadge';
import { AboutModal } from '../common/AboutModal';

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
  const { logout, adminUser, isSuperAdmin, isProductionUser, canAccessPage } = useAuth();
  const { setShowVersionModal, hasUpdate } = useUpdate();
  const { isRtl, language, t } = useLanguage();
  const [isAboutModalOpen, setIsAboutModalOpen] = useState(false);

  // Group 1: Operations
  const operationsNavigation = [
    { id: 'dashboard' as NavigationPage, label: t('nav_dashboard'), icon: LayoutDashboard },
    { id: 'production-entry' as NavigationPage, label: t('nav_production_entry'), icon: PlusCircle },
    { id: 'production-records' as NavigationPage, label: t('nav_production_records'), icon: FileText },
    { id: 'data-review' as NavigationPage, label: t('nav_data_review'), icon: ShieldCheck, badge: language === 'ar' ? 'تدقيق' : 'Audit' },
    { id: 'ai-assistant' as NavigationPage, label: t('nav_ai_assistant'), icon: Sparkles, badge: 'AI' },
  ];

  // Group 2: Management & Master Data
  const managementNavigation = [
    { id: 'raw-materials' as NavigationPage, label: t('nav_raw_materials'), icon: Package },
    { id: 'master-data' as NavigationPage, label: t('nav_master_data'), icon: Database },
    { id: 'historical-import' as NavigationPage, label: t('nav_historical_import'), icon: FileSpreadsheet, badge: 'Excel' },
    { id: 'user-management' as NavigationPage, label: t('nav_user_management'), icon: Users },
    { id: 'reports' as NavigationPage, label: t('nav_reports'), icon: BarChart3 },
  ];

  // Group 3: System & Security
  const systemNavigation = [
    { id: 'branding' as NavigationPage, label: t('nav_branding'), icon: ImageIcon },
    { id: 'backups' as NavigationPage, label: t('nav_backups'), icon: HardDrive },
    { id: 'restore' as NavigationPage, label: t('nav_restore'), icon: RotateCcw },
    { id: 'system-health' as NavigationPage, label: t('nav_system_health'), icon: Activity },
    { id: 'versions' as NavigationPage, label: t('nav_versions'), icon: GitBranch, badge: `v${CURRENT_APP_VERSION.version}` },
    { id: 'settings' as NavigationPage, label: t('nav_settings'), icon: Settings },
  ];

  const handleSelectPage = (page: NavigationPage) => {
    onNavigate(page);
    onCloseMobile();
  };

  // Filter items by permission
  const allowedOps = operationsNavigation.filter(item => canAccessPage(item.id));
  const allowedMgmt = managementNavigation.filter(item => canAccessPage(item.id));
  const allowedSys = systemNavigation.filter(item => canAccessPage(item.id));

  // Determine sidebar placement classes based on direction (RTL = right-0, LTR = left-0)
  const positionClasses = isRtl
    ? `right-0 border-l border-slate-800 ${isOpenMobile ? 'translate-x-0' : 'translate-x-full lg:translate-x-0'}`
    : `left-0 border-r border-slate-800 ${isOpenMobile ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}`;

  return (
    <>
      {/* Mobile Backdrop */}
      {isOpenMobile && (
        <div
          className="fixed inset-0 bg-slate-950/80 backdrop-blur-xs z-40 lg:hidden"
          onClick={onCloseMobile}
        />
      )}

      {/* Modern ASFOUR ERP Sidebar */}
      <aside
        className={`fixed top-0 bottom-0 z-50 w-64 bg-slate-900 text-slate-200 flex flex-col h-full shadow-2xl transition-transform duration-300 ease-in-out select-none ${positionClasses}`}
        dir={isRtl ? 'rtl' : 'ltr'}
      >
        {/* Brand Header */}
        <div className="p-4 sm:p-5 border-b border-slate-800 bg-slate-950/60">
          <div className="flex items-center justify-between">
            <AsfourLogo variant="sidebar" />

            <button
              type="button"
              onClick={onCloseMobile}
              className="lg:hidden w-7 h-7 rounded flex items-center justify-center text-slate-400 hover:text-white hover:bg-slate-800"
            >
              {isRtl ? <ChevronRight className="w-5 h-5" /> : <ChevronLeft className="w-5 h-5" />}
            </button>
          </div>
        </div>

        {/* Navigation List */}
        <nav className="flex-grow py-3 px-2 overflow-y-auto space-y-4">
          {/* Group 1: Operations */}
          {allowedOps.length > 0 && (
            <div>
              <div className="px-3 mb-1 text-[11px] text-amber-400 font-bold uppercase tracking-wider flex items-center gap-1.5">
                <Layers className="w-3 h-3 text-amber-400" />
                <span>{t('nav_group_operations')}</span>
              </div>
              <div className="space-y-0.5">
                {allowedOps.map((item) => {
                  const Icon = item.icon;
                  const isActive = currentPage === item.id || (item.id === 'production-entry' && currentPage === 'production');
                  return (
                    <button
                      key={item.id}
                      id={`nav-item-${item.id}`}
                      type="button"
                      onClick={() => handleSelectPage(item.id)}
                      className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-xs font-semibold transition-all duration-150 cursor-pointer ${
                        isActive
                          ? 'bg-gradient-to-r from-amber-500 to-amber-600 text-slate-950 font-black shadow-md'
                          : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                      }`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <Icon className={`w-4 h-4 shrink-0 ${isActive ? 'text-slate-950' : 'text-slate-400'}`} />
                        <span className="truncate">{item.label}</span>
                      </div>
                      {item.badge && !isActive && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-slate-800 text-amber-400 border border-slate-700 font-mono shrink-0">
                          {item.badge}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Group 2: Management & Master Data */}
          {allowedMgmt.length > 0 && (
            <div>
              <div className="px-3 mb-1 text-[11px] text-indigo-400 font-bold uppercase tracking-wider flex items-center gap-1.5">
                <Database className="w-3 h-3 text-indigo-400" />
                <span>{t('nav_group_management')}</span>
              </div>
              <div className="space-y-0.5">
                {allowedMgmt.map((item) => {
                  const Icon = item.icon;
                  const isActive = currentPage === item.id;
                  return (
                    <button
                      key={item.id}
                      id={`nav-item-${item.id}`}
                      type="button"
                      onClick={() => handleSelectPage(item.id)}
                      className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-xs font-semibold transition-all duration-150 cursor-pointer ${
                        isActive
                          ? 'bg-indigo-600 text-white font-bold shadow-md'
                          : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                      }`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <Icon className={`w-4 h-4 shrink-0 ${isActive ? 'text-white' : 'text-slate-400'}`} />
                        <span className="truncate">{item.label}</span>
                      </div>
                      {item.badge && !isActive && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700 font-mono shrink-0">
                          {item.badge}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Group 3: System & Security */}
          {allowedSys.length > 0 && (
            <div>
              <div className="px-3 mb-1 text-[11px] text-slate-400 font-bold uppercase tracking-wider flex items-center gap-1.5">
                <ShieldCheck className="w-3 h-3 text-slate-400" />
                <span>{t('nav_group_system')}</span>
              </div>
              <div className="space-y-0.5">
                {allowedSys.map((item) => {
                  const Icon = item.icon;
                  const isActive = currentPage === item.id;
                  return (
                    <button
                      key={item.id}
                      id={`nav-item-${item.id}`}
                      type="button"
                      onClick={() => handleSelectPage(item.id)}
                      className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-xs font-semibold transition-all duration-150 cursor-pointer ${
                        isActive
                          ? 'bg-slate-700 text-white font-bold'
                          : 'text-slate-400 hover:bg-slate-800 hover:text-white'
                      }`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <Icon className="w-4 h-4 shrink-0 text-slate-400" />
                        <span className="truncate">{item.label}</span>
                      </div>
                      {item.badge && !isActive && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700 font-mono shrink-0">
                          {item.badge}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </nav>

        {/* Developer Credit & About Modal Trigger */}
        <div className="px-3 py-2 bg-slate-950/70 border-t border-slate-800/80 flex items-center justify-between">
          <button
            type="button"
            onClick={() => setIsAboutModalOpen(true)}
            className="flex items-center gap-2 text-slate-400 hover:text-white transition cursor-pointer text-xs group"
          >
            <DeveloperBadge variant="avatar-only" />
            <div className="text-start leading-tight">
              <span className="text-[10px] text-slate-400 group-hover:text-slate-200 block">
                {t('developed_by_short')}
              </span>
              <span className="text-[9px] font-mono text-amber-400 font-bold">
                ERP v{CURRENT_APP_VERSION.version}
              </span>
            </div>
          </button>

          <button
            type="button"
            onClick={() => setShowVersionModal(true)}
            className="px-2 py-1 rounded-md bg-slate-800 hover:bg-slate-700 text-[10px] text-slate-300 font-mono border border-slate-700"
            title="Version Notes"
          >
            {hasUpdate ? 'Update!' : 'Changelog'}
          </button>
        </div>

        {/* User Profile & Logout Section */}
        <div className="p-3 border-t border-slate-800 bg-slate-950">
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={onOpenProfile}
              className="flex items-center gap-2.5 text-start flex-1 hover:opacity-90 transition cursor-pointer min-w-0"
            >
              <div className={`w-8 h-8 rounded-full ${isProductionUser ? 'bg-amber-500 text-slate-950 font-black' : 'bg-slate-700 text-white font-bold'} border border-slate-600 flex items-center justify-center text-xs shrink-0`}>
                {adminUser?.username?.charAt(0).toUpperCase() || 'A'}
              </div>
              <div className="flex flex-col truncate">
                <span className="text-xs font-bold text-white truncate">
                  {adminUser?.fullName || adminUser?.username || 'مشغل خط الإنتاج'}
                </span>
                <span className={`text-[9px] ${isProductionUser ? 'text-amber-400' : 'text-indigo-400'} font-bold uppercase truncate`}>
                  {adminUser?.role || 'USER'}
                </span>
              </div>
            </button>

            <button
              id="sidebar-logout-btn"
              type="button"
              onClick={() => logout()}
              title={language === 'ar' ? 'تسجيل الخروج' : 'Sign Out'}
              className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-rose-400 hover:bg-slate-800 transition-colors shrink-0 cursor-pointer"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </aside>

      {/* About Modal */}
      <AboutModal
        isOpen={isAboutModalOpen}
        onClose={() => setIsAboutModalOpen(false)}
      />
    </>
  );
};

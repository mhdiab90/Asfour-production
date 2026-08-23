/**
 * ASFOUR Factory Management Web Application (ERP)
 * Production React 18+ Web Application for ASFOUR Refractories
 * Geometric Balance Design Theme - Bilingual (AR/EN) & Granular Permissions
 */
import React, { useState, useEffect } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { LanguageProvider, useLanguage } from './i18n/LanguageContext';
import { NavigationPage } from './types';
import { LoginView } from './components/auth/LoginView';
import { Header } from './components/layout/Header';
import { Sidebar } from './components/layout/Sidebar';
import { MobileNav } from './components/layout/MobileNav';
import { AdminProfileModal } from './components/admin/AdminProfileModal';
import { DashboardView } from './components/dashboard/DashboardView';
import { StageProductionEntryView } from './components/production/StageProductionEntryView';
import { ProductionRecordsView } from './components/production/ProductionRecordsView';
import { DataReviewView } from './components/production/DataReviewView';
import { DataImportView } from './components/admin/DataImportView';
import { RawMaterialsView } from './components/admin/RawMaterialsView';
import { BackupRestoreView } from './components/admin/BackupRestoreView';
import { SystemHealthView } from './components/admin/SystemHealthView';
import { AIAssistantView } from './components/ai/AIAssistantView';
import { MasterDataView } from './components/masterData/MasterDataView';
import { UserManagementView } from './components/users/UserManagementView';
import { BulkEntryView } from './components/bulk/BulkEntryView';
import { ReportsView } from './components/reports/ReportsView';
import { SettingsView } from './components/settings/SettingsView';
import { ErrorBoundary } from './components/common/ErrorBoundary';
import { UpdateProvider, useUpdate } from './context/UpdateContext';
import { BrandingProvider } from './context/BrandingContext';
import { UpdateNotificationBanner } from './components/common/UpdateNotificationBanner';
import { VersionModal } from './components/common/VersionModal';
import { CURRENT_APP_VERSION, DATABASE_SCHEMA_VERSION } from './config/appVersion';
import { ShieldCheck, CheckCircle2, Cpu, Lock, ArrowRight, ArrowLeft } from 'lucide-react';
import { AsfourLogo } from './components/common/AsfourLogo';
import { BrandingView } from './components/admin/BrandingView';

const MainAppContent: React.FC = () => {
  const { isAuthenticated, isLoading, adminUser, isSuperAdmin, isProductionUser, canAccessPage } = useAuth();
  const { language, isRtl, t } = useLanguage();
  const { setShowVersionModal, hasUpdate } = useUpdate();
  
  // Default to 'production-entry' if operator, or 'dashboard' if super admin
  const [currentPage, setCurrentPage] = useState<NavigationPage>('dashboard');
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState<boolean>(false);
  const [isProfileModalOpen, setIsProfileModalOpen] = useState<boolean>(false);
  const [connectionStatus, setConnectionStatus] = useState<'online' | 'offline' | 'syncing'>('online');
  const [showLoginSplash, setShowLoginSplash] = useState<boolean>(true);

  // Synchronize route with browser URL / hash if /production requested
  useEffect(() => {
    const pathname = window.location.pathname;
    const hash = window.location.hash;
    if (pathname.includes('production') || hash.includes('production')) {
      setCurrentPage('production-entry');
    }
  }, []);

  // When auth role is resolved or changes, adjust default page
  useEffect(() => {
    if (isAuthenticated) {
      if (isProductionUser) {
        setCurrentPage('production-entry');
      } else {
        // If current page is not accessible, fallback to first accessible page
        if (!canAccessPage(currentPage)) {
          if (canAccessPage('dashboard')) {
            setCurrentPage('dashboard');
          } else if (canAccessPage('production-entry')) {
            setCurrentPage('production-entry');
          } else if (canAccessPage('production-records')) {
            setCurrentPage('production-records');
          }
        }
      }
    }
  }, [isAuthenticated, isProductionUser]);

  // Monitor network connectivity
  useEffect(() => {
    const handleOnline = () => setConnectionStatus('online');
    const handleOffline = () => setConnectionStatus('offline');

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    if (!navigator.onLine) {
      setConnectionStatus('offline');
    }

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Verification splash transition upon login
  useEffect(() => {
    if (isAuthenticated) {
      const timer = setTimeout(() => {
        setShowLoginSplash(false);
      }, 900);
      return () => clearTimeout(timer);
    } else {
      setShowLoginSplash(true);
    }
  }, [isAuthenticated]);

  const handleCheckConnection = () => {
    setConnectionStatus('syncing');
    setTimeout(() => {
      setConnectionStatus(navigator.onLine ? 'online' : 'offline');
    }, 800);
  };

  // Safe navigation handler enforcing strict RBAC & granular permissions guards
  const handleNavigate = (targetPage: NavigationPage) => {
    // Normalise 'production' alias to 'production-entry'
    const normalizedPage: NavigationPage = targetPage === 'production' ? 'production-entry' : targetPage;

    if (!canAccessPage(normalizedPage)) {
      if (canAccessPage('production-entry')) {
        setCurrentPage('production-entry');
      } else if (canAccessPage('dashboard')) {
        setCurrentPage('dashboard');
      }
      return;
    }
    setCurrentPage(normalizedPage);
  };

  // If waiting for initial auth check
  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center text-white select-none">
        <div className="w-10 h-10 border-4 border-amber-500 border-t-transparent rounded-full animate-spin mb-4"></div>
        <p className="text-xs font-bold text-slate-300 tracking-wider uppercase">{t('loading')}</p>
      </div>
    );
  }

  // If not authenticated, show login view
  if (!isAuthenticated) {
    return <LoginView />;
  }

  // Login Success Verification Transition
  if (showLoginSplash) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center text-white p-6 select-none" dir={isRtl ? 'rtl' : 'ltr'}>
        <div className="max-w-md w-full bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-2xl space-y-4 text-center">
          <div className="flex justify-center mb-2">
            <AsfourLogo variant="compact" size="sm" />
          </div>

          <div className={`w-14 h-14 ${isSuperAdmin ? 'bg-indigo-500/20 text-indigo-400 border-indigo-500/30' : 'bg-amber-500/20 text-amber-400 border-amber-500/30'} border rounded-2xl flex items-center justify-center mx-auto`}>
            {isSuperAdmin ? <ShieldCheck className="w-7 h-7" /> : <Cpu className="w-7 h-7" />}
          </div>
          <div>
            <h2 className="text-base font-bold text-white">
              {isSuperAdmin ? (language === 'ar' ? 'تم التحقق من صلاحيات المشرف العام بنجاح' : 'Super Admin Access Verified') : (language === 'ar' ? 'تم التحقق من صلاحية مشغل النظام' : 'Operator Access Verified')}
            </h2>
            <p className="text-xs text-slate-400 mt-1">
              {isSuperAdmin ? 'ASFOUR Refractories • Full Access' : `${t('welcome')}, ${adminUser?.fullName || adminUser?.employeeName || 'Operator'}`}
            </p>
          </div>
          <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 text-xs font-mono text-start space-y-2 text-slate-300">
            <div className="flex justify-between border-b border-slate-800 pb-1.5">
              <span className="text-slate-400">{language === 'ar' ? 'المستخدم / المشغل:' : 'User:'}</span>
              <span className="text-amber-400 font-bold">{adminUser?.fullName || adminUser?.employeeName || adminUser?.username}</span>
            </div>
            {adminUser?.employeeCode && (
              <div className="flex justify-between border-b border-slate-800 pb-1.5">
                <span className="text-slate-400">{language === 'ar' ? 'كود العامل المرتبط:' : 'Employee Code:'}</span>
                <span className="text-indigo-400 font-bold">{adminUser.employeeCode}</span>
              </div>
            )}
            <div className="flex justify-between border-b border-slate-800 pb-1.5">
              <span className="text-slate-400">{language === 'ar' ? 'الدور والصلاحية:' : 'Role:'}</span>
              <span className={`font-bold ${isSuperAdmin ? 'text-indigo-400' : 'text-emerald-400'}`}>
                {adminUser?.role || 'PRODUCTION_USER'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">{language === 'ar' ? 'وجهة العمل:' : 'Destination:'}</span>
              <span className="text-sky-400 font-bold">
                {isSuperAdmin ? (language === 'ar' ? 'لوحة التحكم الرئيسية' : 'Master Dashboard') : (language === 'ar' ? 'تسجيل الإنتاج الميداني' : 'Production Entry')}
              </span>
            </div>
          </div>
          <p className="text-[11px] text-slate-500 animate-pulse">{language === 'ar' ? 'جارٍ الانتقال الفوري إلى بيئة العمل...' : 'Navigating to workspace...'}</p>
        </div>
      </div>
    );
  }

  // Check if current page is allowed for user
  const isPageAllowed = canAccessPage(currentPage);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col lg:flex-row select-none" dir={isRtl ? 'rtl' : 'ltr'}>
      {/* Geometric Balance Sidebar */}
      <Sidebar
        currentPage={currentPage}
        onNavigate={handleNavigate}
        isOpenMobile={isMobileMenuOpen}
        onCloseMobile={() => setIsMobileMenuOpen(false)}
        onOpenProfile={() => setIsProfileModalOpen(true)}
      />

      {/* Main Content Area */}
      <div className={`flex-1 ${isRtl ? 'lg:mr-64' : 'lg:ml-64'} flex flex-col min-h-screen pb-16 lg:pb-0`}>
        {/* Top Header */}
        <Header
          currentPage={currentPage}
          onNavigate={handleNavigate}
          onOpenMobileMenu={() => setIsMobileMenuOpen(true)}
          onOpenProfile={() => setIsProfileModalOpen(true)}
          connectionStatus={connectionStatus}
          onCheckConnection={handleCheckConnection}
        />

        {/* Dynamic Page Views */}
        <main className="flex-1 p-4 sm:p-6 lg:p-6 w-full max-w-7xl mx-auto flex flex-col gap-6">
          {!isPageAllowed ? (
            /* Access Denied Card */
            <div className="p-8 bg-white rounded-2xl border border-rose-200 shadow-xs text-center space-y-4 max-w-lg mx-auto my-12">
              <div className="w-12 h-12 rounded-2xl bg-rose-50 border border-rose-200 text-rose-600 flex items-center justify-center mx-auto">
                <Lock className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-base font-black text-slate-800">
                  {language === 'ar' ? 'عفواً، لا تملك الصلاحية الكافية لعرض هذه الشاشة' : 'Access Restricted'}
                </h3>
                <p className="text-xs text-slate-500 mt-1">
                  {language === 'ar' ? 'يرجى مراجعة المشرف العام لتعديل صلاحيات حسابك في لوحة المستخدمين.' : 'Contact Super Admin to grant granular permissions for this module.'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => handleNavigate('production-entry')}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-xl transition cursor-pointer inline-flex items-center gap-1.5"
              >
                <span>{language === 'ar' ? 'العودة لشاشة تسجيل الإنتاج' : 'Return to Production Entry'}</span>
                {isRtl ? <ArrowLeft className="w-4 h-4" /> : <ArrowRight className="w-4 h-4" />}
              </button>
            </div>
          ) : (
            <>
              {/* Super Admin Dashboard */}
              {currentPage === 'dashboard' && (
                <DashboardView onNavigate={handleNavigate} />
              )}

              {/* Production Entry Form (Accessible by both Admin and Production User; routed to /production) */}
              {(currentPage === 'production-entry' || currentPage === 'production') && (
                <StageProductionEntryView onNavigate={handleNavigate} />
              )}

              {/* Production Records View (Accessible by both Admin and Production User) */}
              {currentPage === 'production-records' && (
                <ProductionRecordsView onNavigate={handleNavigate} />
              )}

              {/* Data Review & Versioned Audits View */}
              {currentPage === 'data-review' && (
                <DataReviewView />
              )}

              {/* Historical Import Center */}
              {(currentPage === 'historical-import' || currentPage === 'bulk-entry') && (
                <DataImportView />
              )}

              {/* Raw Materials & Stock Management */}
              {currentPage === 'raw-materials' && (
                <RawMaterialsView />
              )}

              {/* Backup & Disaster Recovery Center */}
              {(currentPage === 'backup-restore' || currentPage === 'backups') && (
                <BackupRestoreView initialTab="backups" />
              )}

              {/* Dedicated Restore Center */}
              {currentPage === 'restore' && (
                <BackupRestoreView initialTab="restore" />
              )}

              {/* System Health & Cloud Connection */}
              {currentPage === 'system-health' && (
                <SystemHealthView initialTab="health" />
              )}

              {/* System Versions & Changelog */}
              {currentPage === 'versions' && (
                <SystemHealthView initialTab="history" />
              )}

              {/* AI Factory Assistant */}
              {currentPage === 'ai-assistant' && (
                <AIAssistantView />
              )}

              {/* Admin-only views */}
              {currentPage === 'master-data' && (
                <MasterDataView onNavigate={handleNavigate} />
              )}

              {/* Super Admin User Management */}
              {currentPage === 'user-management' && (
                <UserManagementView onNavigate={handleNavigate} />
              )}

              {currentPage === 'reports' && (
                <ReportsView onNavigate={handleNavigate} />
              )}

              {currentPage === 'branding' && (
                <BrandingView />
              )}

              {currentPage === 'settings' && (
                <SettingsView onNavigate={handleNavigate} />
              )}
            </>
          )}
        </main>

        {/* Geometric Balance Persistent Footer */}
        <footer className="h-10 bg-slate-900 border-t border-slate-800 flex items-center justify-between px-6 text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-auto">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowVersionModal(true)}
              className="flex items-center gap-1.5 text-slate-300 hover:text-amber-400 transition cursor-pointer"
            >
              <span className={`w-2 h-2 rounded-full ${hasUpdate ? 'bg-amber-400 animate-ping' : 'bg-emerald-400'}`} />
              <span className="font-mono">ASFOUR ERP v{CURRENT_APP_VERSION.version}</span>
              <span className="text-[9px] bg-slate-800 px-1.5 py-0.5 rounded text-slate-400 border border-slate-700">Schema v{DATABASE_SCHEMA_VERSION}</span>
            </button>
          </div>
          <div className="flex gap-4 items-center">
            <span className="text-emerald-400">{language === 'ar' ? 'متصل بقاعدة البيانات السحابية ✅' : 'Cloud Database Online ✅'}</span>
            <span className="font-mono text-slate-400">
              {isSuperAdmin ? `ADMIN: ${adminUser?.email || 'SUPER_ADMIN'}` : `USER: ${adminUser?.employeeCode || adminUser?.email}`}
            </span>
          </div>
        </footer>
      </div>

      {/* Mobile Bottom Navigation */}
      <MobileNav
        currentPage={currentPage}
        onNavigate={handleNavigate}
      />

      {/* Admin Profile Modal */}
      <AdminProfileModal
        isOpen={isProfileModalOpen}
        onClose={() => setIsProfileModalOpen(false)}
      />

      {/* Auto-Update Toast / Banner */}
      <UpdateNotificationBanner />

      {/* System Version & Changelog Modal */}
      <VersionModal />
    </div>
  );
};

export default function App() {
  return (
    <ErrorBoundary>
      <LanguageProvider>
        <AuthProvider>
          <BrandingProvider>
            <UpdateProvider>
              <MainAppContent />
            </UpdateProvider>
          </BrandingProvider>
        </AuthProvider>
      </LanguageProvider>
    </ErrorBoundary>
  );
}

/**
 * ASFOUR Factory Management Login View
 * Corporate branding with ASFOUR logo, bilingual switching (AR / EN),
 * and dual authentication tabs for Super Admin and Production Operators.
 */
import React, { useState } from 'react';
import { 
  ShieldCheck, 
  Lock, 
  User as UserIcon, 
  ArrowLeft, 
  ArrowRight,
  AlertCircle, 
  Layers, 
  Eye, 
  EyeOff,
  Cpu,
  Mail,
  CheckCircle2,
  Globe
} from 'lucide-react';
import { useAuth, SECURITY_ADMIN_EMAIL } from '../../context/AuthContext';
import { AsfourLogo } from '../common/AsfourLogo';
import { DeveloperBadge } from '../common/DeveloperBadge';
import { useLanguage } from '../../i18n/LanguageContext';
import { LanguageSwitcher } from '../common/LanguageSwitcher';

export const LoginView: React.FC = () => {
  const { login, isLoading, authError, clearError } = useAuth();
  const { language, isRtl, t } = useLanguage();
  
  // Tab State: 'admin' | 'operator'
  const [activeTab, setActiveTab] = useState<'admin' | 'operator'>('admin');

  // Admin Credentials
  const [adminIdentifier, setAdminIdentifier] = useState('admin');
  const [adminPassword, setAdminPassword] = useState('M124578');
  const [showAdminPassword, setShowAdminPassword] = useState(false);

  // Operator Credentials
  const [operatorEmail, setOperatorEmail] = useState('');
  const [operatorPassword, setOperatorPassword] = useState('');
  const [showOperatorPassword, setShowOperatorPassword] = useState(false);

  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleAdminSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adminIdentifier.trim() || !adminPassword.trim()) return;

    setIsSubmitting(true);
    clearError();
    try {
      await login(adminIdentifier, adminPassword);
    } catch (err) {
      console.error('Admin login attempt failed:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleOperatorSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!operatorEmail.trim() || !operatorPassword.trim()) return;

    setIsSubmitting(true);
    clearError();
    try {
      await login(operatorEmail, operatorPassword);
    } catch (err) {
      console.error('Operator login attempt failed:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col justify-center items-center p-4 sm:p-6 relative overflow-hidden select-none" dir={isRtl ? 'rtl' : 'ltr'}>
      {/* Background subtle geometric grid */}
      <div className="absolute inset-0 bg-[radial-gradient(#1e293b_1px,transparent_1px)] [background-size:24px_24px] opacity-40"></div>

      {/* Top Bar Language Switcher */}
      <div className="absolute top-4 right-4 z-20">
        <LanguageSwitcher variant="pill" />
      </div>

      <div className="w-full max-w-md relative z-10 my-auto py-4">
        {/* Official ASFOUR Brand Header */}
        <div className="text-center mb-6">
          <AsfourLogo variant="login" subtitleLang={language} />
        </div>

        {/* Dual Mode Switcher Tabs */}
        <div className="bg-slate-900/90 p-1.5 rounded-2xl border border-slate-800 flex items-center gap-1.5 mb-4 shadow-xl">
          <button
            type="button"
            id="tab-admin-login"
            onClick={() => {
              setActiveTab('admin');
              clearError();
            }}
            className={`flex-1 flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl text-xs font-extrabold transition-all cursor-pointer ${
              activeTab === 'admin'
                ? 'bg-indigo-600 text-white shadow-md'
                : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
            }`}
          >
            <ShieldCheck className="w-4 h-4" />
            <span>{t('login_admin_tab')}</span>
          </button>

          <button
            type="button"
            id="tab-operator-login"
            onClick={() => {
              setActiveTab('operator');
              clearError();
            }}
            className={`flex-1 flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl text-xs font-extrabold transition-all cursor-pointer ${
              activeTab === 'operator'
                ? 'bg-amber-500 text-slate-950 shadow-md font-black'
                : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
            }`}
          >
            <Cpu className="w-4 h-4" />
            <span>{t('login_operator_tab')}</span>
          </button>
        </div>

        {/* Login Card */}
        <div className="bg-slate-900 border border-slate-800 shadow-2xl rounded-2xl p-6 sm:p-7">
          {/* Header info based on active tab */}
          {activeTab === 'admin' ? (
            <div className="mb-5 pb-3 border-b border-slate-800 flex items-center justify-between">
              <div>
                <h2 className="text-sm sm:text-base font-bold text-white flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-indigo-400" />
                  <span>{t('login_admin_tab')}</span>
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  {t('login_admin_subtitle')}
                </p>
              </div>
              <span className="text-[10px] px-2 py-0.5 bg-indigo-500/10 text-indigo-400 font-mono font-bold border border-indigo-500/20 rounded-md shrink-0">
                SUPER_ADMIN
              </span>
            </div>
          ) : (
            <div className="mb-5 pb-3 border-b border-slate-800 flex items-center justify-between">
              <div>
                <h2 className="text-sm sm:text-base font-bold text-amber-400 flex items-center gap-2">
                  <Cpu className="w-4 h-4 text-amber-400" />
                  <span>{t('login_operator_tab')}</span>
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  {t('login_operator_subtitle')}
                </p>
              </div>
              <span className="text-[10px] px-2 py-0.5 bg-amber-400/10 text-amber-400 font-mono font-bold border border-amber-400/20 rounded-md shrink-0">
                PRODUCTION_USER
              </span>
            </div>
          )}

          {/* Error Message */}
          {authError && (
            <div className="mb-4 p-3 bg-rose-950/60 border border-rose-800/80 text-rose-200 text-xs rounded-xl flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="font-bold text-rose-300">{language === 'ar' ? 'تعذر إكمال عملية المصادقة' : 'Authentication Failed'}</p>
                <p className="mt-1 leading-relaxed">{authError}</p>
              </div>
            </div>
          )}

          {/* Form 1: Super Admin Login */}
          {activeTab === 'admin' && (
            <form onSubmit={handleAdminSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1.5 uppercase tracking-wider">
                  {t('email_username')}
                </label>
                <div className="relative">
                  <div className={`absolute inset-y-0 ${isRtl ? 'right-0 pr-3.5' : 'left-0 pl-3.5'} flex items-center pointer-events-none text-slate-500`}>
                    <UserIcon className="w-4 h-4" />
                  </div>
                  <input
                    id="admin-username-input"
                    type="text"
                    required
                    value={adminIdentifier}
                    onChange={(e) => setAdminIdentifier(e.target.value)}
                    placeholder="admin"
                    className={`w-full bg-slate-950 border border-slate-800 rounded-xl ${isRtl ? 'pr-10 pl-4' : 'pl-10 pr-4'} py-2.5 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-indigo-500 transition-colors font-mono`}
                  />
                </div>
                <p className="text-[11px] text-slate-500 mt-1 flex items-center gap-1">
                  <span className="text-indigo-400 font-mono">admin</span> &rarr; {language === 'ar' ? 'البريد الأمني' : 'Security Admin'}: <span className="font-mono text-slate-400">{SECURITY_ADMIN_EMAIL}</span>
                </p>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1.5 uppercase tracking-wider">
                  {t('password_label')}
                </label>
                <div className="relative">
                  <div className={`absolute inset-y-0 ${isRtl ? 'right-0 pr-3.5' : 'left-0 pl-3.5'} flex items-center pointer-events-none text-slate-500`}>
                    <Lock className="w-4 h-4" />
                  </div>
                  <input
                    id="admin-password-input"
                    type={showAdminPassword ? 'text' : 'password'}
                    required
                    value={adminPassword}
                    onChange={(e) => setAdminPassword(e.target.value)}
                    placeholder="••••••••"
                    className={`w-full bg-slate-950 border border-slate-800 rounded-xl ${isRtl ? 'pr-10 pl-10' : 'pl-10 pr-10'} py-2.5 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-indigo-500 transition-colors font-mono`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowAdminPassword(!showAdminPassword)}
                    className={`absolute inset-y-0 ${isRtl ? 'left-0 pl-3.5' : 'right-0 pr-3.5'} flex items-center text-slate-500 hover:text-slate-300 cursor-pointer`}
                  >
                    {showAdminPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <button
                id="admin-login-submit-btn"
                type="submit"
                disabled={isSubmitting || isLoading}
                className="w-full mt-2 py-3 px-4 bg-indigo-600 hover:bg-indigo-500 text-white font-extrabold text-xs sm:text-sm rounded-xl shadow-md flex items-center justify-center gap-2 transition-all duration-150 active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
              >
                {isSubmitting || isLoading ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                    <span>{t('login_authenticating')}</span>
                  </>
                ) : (
                  <>
                    <span>{t('login_btn_admin')}</span>
                    {isRtl ? <ArrowLeft className="w-4 h-4" /> : <ArrowRight className="w-4 h-4" />}
                  </>
                )}
              </button>
            </form>
          )}

          {/* Form 2: Production Operator Login */}
          {activeTab === 'operator' && (
            <form onSubmit={handleOperatorSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1.5 uppercase tracking-wider">
                  {language === 'ar' ? 'البريد الإلكتروني للمشغل أو كود العامل *' : 'Operator Email or Employee Code *'}
                </label>
                <div className="relative">
                  <div className={`absolute inset-y-0 ${isRtl ? 'right-0 pr-3.5' : 'left-0 pl-3.5'} flex items-center pointer-events-none text-amber-500`}>
                    <Mail className="w-4 h-4" />
                  </div>
                  <input
                    id="operator-email-input"
                    type="text"
                    required
                    value={operatorEmail}
                    onChange={(e) => setOperatorEmail(e.target.value)}
                    placeholder="operator_101@asfour.local"
                    className={`w-full bg-slate-950 border border-slate-800 rounded-xl ${isRtl ? 'pr-10 pl-4' : 'pl-10 pr-4'} py-2.5 text-sm text-amber-400 placeholder:text-slate-600 focus:outline-none focus:border-amber-500 transition-colors font-mono`}
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1.5 uppercase tracking-wider">
                  {t('password_label')} *
                </label>
                <div className="relative">
                  <div className={`absolute inset-y-0 ${isRtl ? 'right-0 pr-3.5' : 'left-0 pl-3.5'} flex items-center pointer-events-none text-slate-500`}>
                    <Lock className="w-4 h-4" />
                  </div>
                  <input
                    id="operator-password-input"
                    type={showOperatorPassword ? 'text' : 'password'}
                    required
                    value={operatorPassword}
                    onChange={(e) => setOperatorPassword(e.target.value)}
                    placeholder="••••••••"
                    className={`w-full bg-slate-950 border border-slate-800 rounded-xl ${isRtl ? 'pr-10 pl-10' : 'pl-10 pr-10'} py-2.5 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-amber-500 transition-colors font-mono`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowOperatorPassword(!showOperatorPassword)}
                    className={`absolute inset-y-0 ${isRtl ? 'left-0 pl-3.5' : 'right-0 pr-3.5'} flex items-center text-slate-500 hover:text-slate-300 cursor-pointer`}
                  >
                    {showOperatorPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <button
                id="operator-login-submit-btn"
                type="submit"
                disabled={isSubmitting || isLoading}
                className="w-full mt-2 py-3 px-4 bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-xs sm:text-sm rounded-xl shadow-md flex items-center justify-center gap-2 transition-all duration-150 active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
              >
                {isSubmitting || isLoading ? (
                  <>
                    <div className="w-4 h-4 border-2 border-slate-950 border-t-transparent rounded-full animate-spin"></div>
                    <span>{t('login_authenticating')}</span>
                  </>
                ) : (
                  <>
                    <span>{t('login_btn_operator')}</span>
                    {isRtl ? <ArrowLeft className="w-4 h-4" /> : <ArrowRight className="w-4 h-4" />}
                  </>
                )}
              </button>
            </form>
          )}

          {/* Security Notice */}
          <div className="mt-5 pt-3 border-t border-slate-800">
            <div className="bg-slate-950 p-2.5 rounded-xl border border-slate-800/80 text-[11px] text-slate-400 flex items-center gap-2">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              <p className="truncate">
                {t('login_security_notice')}
              </p>
            </div>
          </div>
        </div>

        {/* Developer Discreet Credit at Login Footer */}
        <div className="text-center mt-6 space-y-1">
          <DeveloperBadge variant="login" />
          <p className="text-[10px] text-slate-500 font-mono">
            Firebase Cloud Project: asfourproduction-70e6e &bull; Schema v3
          </p>
        </div>
      </div>
    </div>
  );
};

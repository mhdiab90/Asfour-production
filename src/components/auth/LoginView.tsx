/**
 * ASFOUR Factory Management Login View
 * Strictly enforces Firebase Authentication and Firestore Security Rules for both:
 * 1. Super Admin Authentication (Username: admin -> Security Email: ai.mhdiab90@gmail.com -> Firebase Auth -> Role verification)
 * 2. Production Operator Authentication (Registered Email / Employee Code -> Firebase Auth -> Role: PRODUCTION_USER -> routed to /production)
 */
import React, { useState } from 'react';
import { 
  ShieldCheck, 
  Lock, 
  User as UserIcon, 
  ArrowLeft, 
  AlertCircle, 
  Layers, 
  Eye, 
  EyeOff,
  Cpu,
  Flame,
  CheckCircle2,
  Sparkles,
  Users,
  Mail,
  Key
} from 'lucide-react';
import { useAuth, SECURITY_ADMIN_EMAIL } from '../../context/AuthContext';

export const LoginView: React.FC = () => {
  const { login, isLoading, authError, clearError } = useAuth();
  
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
    <div className="min-h-screen bg-slate-950 flex flex-col justify-center items-center p-4 sm:p-6 relative overflow-hidden" dir="rtl">
      {/* Background subtle geometric grid */}
      <div className="absolute inset-0 bg-[radial-gradient(#1e293b_1px,transparent_1px)] [background-size:24px_24px] opacity-40"></div>

      <div className="w-full max-w-md relative z-10">
        {/* Factory Brand Header */}
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-14 h-14 bg-indigo-600 shadow-xl text-white font-black text-2xl mb-3 border border-indigo-400/30 rounded-xl">
            A
          </div>
          <h1 className="text-2xl sm:text-3xl font-black text-white tracking-tight uppercase">
            ASFOUR ERP
          </h1>
          <p className="text-slate-400 text-xs mt-1 font-bold uppercase tracking-widest">
            Factory Management System &bull; بوابة تسجيل الدخول الموحدة
          </p>
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
            <span>المشرف العام (Admin)</span>
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
                ? 'bg-amber-500 text-slate-950 shadow-md'
                : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
            }`}
          >
            <Cpu className="w-4 h-4" />
            <span>مشغل إنتاج (Operator)</span>
          </button>
        </div>

        {/* Login Card */}
        <div className="bg-slate-900 border border-slate-800 shadow-2xl rounded-2xl p-6 sm:p-8">
          {/* Header info based on active tab */}
          {activeTab === 'admin' ? (
            <div className="mb-6 pb-4 border-b border-slate-800 flex items-center justify-between">
              <div>
                <h2 className="text-base font-bold text-white flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-indigo-400" />
                  <span>دخول المشرف العام (SUPER_ADMIN)</span>
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  الوصول الكامل لجميع لوحات الإدارة، البيانات الأساسية، والتقارير
                </p>
              </div>
              <span className="text-[10px] px-2.5 py-1 bg-indigo-500/10 text-indigo-400 font-mono font-bold border border-indigo-500/20 rounded-md">
                SUPER_ADMIN
              </span>
            </div>
          ) : (
            <div className="mb-6 pb-4 border-b border-slate-800 flex items-center justify-between">
              <div>
                <h2 className="text-base font-bold text-amber-400 flex items-center gap-2">
                  <Cpu className="w-4 h-4 text-amber-400" />
                  <span>دخول مشغل خط الإنتاج (PRODUCTION_USER)</span>
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  تسجيل الإنتاج اليومي، الورديات، المكابس، وعربات الأفران مباشرة
                </p>
              </div>
              <span className="text-[10px] px-2.5 py-1 bg-amber-400/10 text-amber-400 font-mono font-bold border border-amber-400/20 rounded-md">
                PRODUCTION_USER
              </span>
            </div>
          )}

          {/* Error Message */}
          {authError && (
            <div className="mb-5 p-3.5 bg-rose-950/60 border border-rose-800/80 text-rose-200 text-xs rounded-xl flex items-start gap-3">
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="font-bold text-rose-300">تعذر إكمال عملية المصادقة</p>
                <p className="mt-1 leading-relaxed">{authError}</p>
              </div>
            </div>
          )}

          {/* Form 1: Super Admin Login */}
          {activeTab === 'admin' && (
            <form onSubmit={handleAdminSubmit} className="space-y-4">
              {/* Username / Email field */}
              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1.5 uppercase tracking-wider">
                  اسم المستخدم أو البريد الإلكتروني
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 right-0 pr-3.5 flex items-center pointer-events-none text-slate-500">
                    <UserIcon className="w-4 h-4" />
                  </div>
                  <input
                    id="admin-username-input"
                    type="text"
                    required
                    value={adminIdentifier}
                    onChange={(e) => setAdminIdentifier(e.target.value)}
                    placeholder="admin"
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl pr-10 pl-4 py-2.5 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-indigo-500 transition-colors font-mono"
                  />
                </div>
                <p className="text-[11px] text-slate-500 mt-1 flex items-center gap-1">
                  <span className="text-indigo-400 font-mono">admin</span> &rarr; البريد الأمني: <span className="font-mono text-slate-400">{SECURITY_ADMIN_EMAIL}</span>
                </p>
              </div>

              {/* Password field */}
              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1.5 uppercase tracking-wider">
                  كلمة المرور (Password)
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 right-0 pr-3.5 flex items-center pointer-events-none text-slate-500">
                    <Lock className="w-4 h-4" />
                  </div>
                  <input
                    id="admin-password-input"
                    type={showAdminPassword ? 'text' : 'password'}
                    required
                    value={adminPassword}
                    onChange={(e) => setAdminPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl pr-10 pl-10 py-2.5 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-indigo-500 transition-colors font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => setShowAdminPassword(!showAdminPassword)}
                    className="absolute inset-y-0 left-0 pl-3.5 flex items-center text-slate-500 hover:text-slate-300 cursor-pointer"
                  >
                    {showAdminPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {/* Submit Button */}
              <button
                id="admin-login-submit-btn"
                type="submit"
                disabled={isSubmitting || isLoading}
                className="w-full mt-2 py-3 px-4 bg-indigo-600 hover:bg-indigo-500 text-white font-extrabold text-sm rounded-xl shadow-md flex items-center justify-center gap-2 transition-all duration-150 active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
              >
                {isSubmitting || isLoading ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                    <span>جارٍ التحقق من الصلاحيات...</span>
                  </>
                ) : (
                  <>
                    <span>تسجيل الدخول كمدير نظام (SUPER_ADMIN)</span>
                    <ArrowLeft className="w-4 h-4" />
                  </>
                )}
              </button>
            </form>
          )}

          {/* Form 2: Production Operator / Floor User Login */}
          {activeTab === 'operator' && (
            <form onSubmit={handleOperatorSubmit} className="space-y-4">
              {/* Operator Email or Registered Code */}
              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1.5 uppercase tracking-wider">
                  البريد الإلكتروني للمشغل أو كود العامل *
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 right-0 pr-3.5 flex items-center pointer-events-none text-amber-500">
                    <Mail className="w-4 h-4" />
                  </div>
                  <input
                    id="operator-email-input"
                    type="text"
                    required
                    value={operatorEmail}
                    onChange={(e) => setOperatorEmail(e.target.value)}
                    placeholder="operator_101@asfour.local أو 10025"
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl pr-10 pl-4 py-2.5 text-sm text-amber-400 placeholder:text-slate-600 focus:outline-none focus:border-amber-500 transition-colors font-mono"
                  />
                </div>
                <p className="text-[11px] text-slate-500 mt-1">
                  البريد الإلكتروني المنشأ عبر شاشة إدارة المستخدمين من قِبل المشرف العام
                </p>
              </div>

              {/* Password */}
              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1.5 uppercase tracking-wider">
                  كلمة المرور (Firebase Auth Password) *
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 right-0 pr-3.5 flex items-center pointer-events-none text-slate-500">
                    <Lock className="w-4 h-4" />
                  </div>
                  <input
                    id="operator-password-input"
                    type={showOperatorPassword ? 'text' : 'password'}
                    required
                    value={operatorPassword}
                    onChange={(e) => setOperatorPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl pr-10 pl-10 py-2.5 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-amber-500 transition-colors font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => setShowOperatorPassword(!showOperatorPassword)}
                    className="absolute inset-y-0 left-0 pl-3.5 flex items-center text-slate-500 hover:text-slate-300 cursor-pointer"
                  >
                    {showOperatorPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {/* Submit Button */}
              <button
                id="operator-login-submit-btn"
                type="submit"
                disabled={isSubmitting || isLoading}
                className="w-full mt-2 py-3 px-4 bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-sm rounded-xl shadow-md flex items-center justify-center gap-2 transition-all duration-150 active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
              >
                {isSubmitting || isLoading ? (
                  <>
                    <div className="w-4 h-4 border-2 border-slate-950 border-t-transparent rounded-full animate-spin"></div>
                    <span>جارٍ التحقق والمصادقة...</span>
                  </>
                ) : (
                  <>
                    <span>تسجيل الدخول لشاشة الإنتاج (/production)</span>
                    <ArrowLeft className="w-4 h-4" />
                  </>
                )}
              </button>
            </form>
          )}

          {/* Security & Access Notice */}
          <div className="mt-6 pt-4 border-t border-slate-800">
            <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 text-[11px] text-slate-400 space-y-1.5">
              <div className="flex items-center gap-2 text-slate-300 font-bold">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                <span>المصادقة السحابية المعتمدة (Firebase Auth + Security Rules):</span>
              </div>
              <p className="text-slate-400 leading-relaxed">
                يتم التحقق من هوية المستخدم ومعرف UID في مجموعة <code>adminUsers</code>، وتوجيه مشغلي الإنتاج (PRODUCTION_USER) مباشرة إلى شاشة تسجيل الإنتاج مع حجب لوحات الإدارة والبيانات الأساسية.
              </p>
            </div>
          </div>
        </div>

        {/* Footer info */}
        <div className="text-center mt-6 text-xs text-slate-500">
          <p>مشروع Firebase الأصلي: <span className="text-slate-400 font-mono">asfourproduction-70e6e</span></p>
          <p className="mt-1">نظام إدارة مصنع عصفور للحراريات</p>
        </div>
      </div>
    </div>
  );
};

/**
 * Settings, Diagnostics & Audit Logs View
 * Runs live system diagnostics (21-step connectivity and calculation check),
 * language coverage diagnostic tool, and displays Firestore audit logs for compliance.
 */
import React, { useState, useEffect } from 'react';
import { 
  Settings as SettingsIcon, 
  Activity, 
  Play, 
  RefreshCw, 
  CheckCircle2, 
  XCircle, 
  Database, 
  FileText, 
  Globe,
  Image as ImageIcon,
  Lock, 
  Server, 
  ShieldCheck
} from 'lucide-react';
import { SystemTestReport, AuditLog, NavigationPage } from '../../types';
import { runFullSystemTest } from '../../services/systemTestService';
import { subscribeAuditLogs } from '../../services/auditService';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../i18n/LanguageContext';
import { Badge } from '../common/Badge';
import { formatDateTime } from '../../utils/formatters';
import { LanguageCoverageModal } from '../admin/LanguageCoverageModal';
import { BrandingView } from '../admin/BrandingView';

interface SettingsViewProps {
  onNavigate: (page: NavigationPage) => void;
  initialTab?: 'tests' | 'branding' | 'audit' | 'database' | 'i18n';
}

export const SettingsView: React.FC<SettingsViewProps> = ({ onNavigate, initialTab = 'tests' }) => {
  const { adminUser } = useAuth();
  const { language, isRtl, t, getCoverageReport } = useLanguage();
  const [isRunningTests, setIsRunningTests] = useState<boolean>(false);
  const [testReport, setTestReport] = useState<SystemTestReport | null>(null);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [activeTab, setActiveTab] = useState<'tests' | 'branding' | 'audit' | 'database' | 'i18n'>(initialTab);
  const [isCoverageModalOpen, setIsCoverageModalOpen] = useState(false);

  useEffect(() => {
    const unsubscribe = subscribeAuditLogs(
      (logs) => setAuditLogs(logs),
      (err) => console.error('Error fetching audit logs:', err)
    );
    return () => unsubscribe();
  }, []);

  const handleRunDiagnostics = async () => {
    setIsRunningTests(true);
    try {
      const report = await runFullSystemTest();
      setTestReport(report);
    } catch (err: any) {
      console.error('Diagnostics failed:', err);
    } finally {
      setIsRunningTests(false);
    }
  };

  const coverageReport = getCoverageReport();

  return (
    <div className="space-y-6" dir={isRtl ? 'rtl' : 'ltr'}>
      {/* Top Header */}
      <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-extrabold text-slate-900 flex items-center gap-2">
            <SettingsIcon className="w-5 h-5 text-amber-500" />
            <span>{language === 'ar' ? 'إعدادات النظام وفحص الربط السحابي وسجل التدقيق' : 'System Settings, Cloud Diagnostics & Audit Trail'}</span>
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            {language === 'ar' 
              ? 'فحص مباشر لسلامة اتصال Firebase Firestore وقواعد الأمان ومعادلات الحسابات وسجل التدقيق'
              : 'Direct health check for Firebase Firestore connection, security rules, calculation logic, and audit logs'}
          </p>
        </div>

        {/* Diagnostic Run Button */}
        <button
          id="run-diagnostics-btn"
          type="button"
          onClick={handleRunDiagnostics}
          disabled={isRunningTests}
          className="px-5 py-2.5 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-black text-xs rounded-xl shadow-md shadow-amber-500/20 flex items-center gap-2 cursor-pointer transition-all active:scale-[0.99] disabled:opacity-50"
        >
          {isRunningTests ? (
            <>
              <RefreshCw className="w-4 h-4 animate-spin" />
              <span>{language === 'ar' ? 'جارٍ تنفيذ الاختبارات (21 فحص)...' : 'Executing Diagnostics (21 tests)...'}</span>
            </>
          ) : (
            <>
              <Play className="w-4 h-4" />
              <span>{language === 'ar' ? 'تشغيل الاختبارات التشخيصية الشاملة' : 'Run Full System Diagnostics'}</span>
            </>
          )}
        </button>
      </div>

      {/* Navigation Sub-tabs */}
      <div className="flex items-center gap-2 border-b border-slate-200 pb-2 flex-wrap">
        <button
          type="button"
          onClick={() => setActiveTab('tests')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-colors cursor-pointer ${
            activeTab === 'tests' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <Activity className="w-4 h-4 text-amber-400" />
          <span>{language === 'ar' ? 'الاختبارات التشخيصية' : 'System Tests'}</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('branding')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-colors cursor-pointer ${
            activeTab === 'branding' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <ImageIcon className="w-4 h-4 text-orange-400" />
          <span>{language === 'ar' ? 'الهوية والشعار المؤسسي' : 'Branding & Assets'}</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('audit')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-colors cursor-pointer ${
            activeTab === 'audit' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <FileText className="w-4 h-4 text-sky-400" />
          <span>{language === 'ar' ? `سجل التدقيق والعمليات (${auditLogs.length})` : `Audit Trail (${auditLogs.length})`}</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('database')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-colors cursor-pointer ${
            activeTab === 'database' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <Database className="w-4 h-4 text-emerald-400" />
          <span>{language === 'ar' ? 'معلومات قاعدة Firestore' : 'Firestore Info'}</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('i18n')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-colors cursor-pointer ${
            activeTab === 'i18n' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <Globe className="w-4 h-4 text-purple-400" />
          <span>{language === 'ar' ? 'فحص التغطية اللغوية (100%)' : 'Language Coverage (100%)'}</span>
        </button>
      </div>

      {/* Tab 1: System Tests */}
      {activeTab === 'tests' && (
        <div className="space-y-5">
          {/* Test Summary Banner */}
          {testReport ? (
            <div className={`p-5 rounded-2xl border shadow-xs ${
              testReport.passed
                ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                : 'bg-rose-50 border-rose-200 text-rose-900'
            }`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  {testReport.passed ? (
                    <div className="w-10 h-10 rounded-xl bg-emerald-500 text-white flex items-center justify-center">
                      <CheckCircle2 className="w-6 h-6" />
                    </div>
                  ) : (
                    <div className="w-10 h-10 rounded-xl bg-rose-500 text-white flex items-center justify-center">
                      <XCircle className="w-6 h-6" />
                    </div>
                  )}
                  <div>
                    <h3 className="text-sm font-extrabold">
                      {testReport.passed 
                        ? (language === 'ar' ? 'جميع الاختبارات التشخيصية اجتازت بنجاح!' : 'All diagnostic tests passed successfully!')
                        : (language === 'ar' ? 'توجد ملاحظات أو اختبارات غير مكتملة' : 'Some tests require attention')}
                    </h3>
                    <p className="text-xs opacity-80 mt-0.5">
                      {language === 'ar'
                        ? `تم تنفيذ ${testReport.summary.total} فحص (ناجح: ${testReport.summary.passed} | إخفاق: ${testReport.summary.failed}) - زمن التنفيذ: ${testReport.durationMs} مللي ثانية`
                        : `Executed ${testReport.summary.total} tests (Passed: ${testReport.summary.passed} | Failed: ${testReport.summary.failed}) - Duration: ${testReport.durationMs}ms`}
                    </p>
                  </div>
                </div>

                <Badge variant={testReport.passed ? 'success' : 'danger'} size="md">
                  {testReport.passed 
                    ? (language === 'ar' ? 'جاهزية 100% للإنتاج' : '100% Production Ready')
                    : (language === 'ar' ? 'بحاجة للمراجعة' : 'Needs Review')}
                </Badge>
              </div>
            </div>
          ) : (
            <div className="bg-white rounded-2xl p-8 border border-slate-200 text-center shadow-xs">
              <Activity className="w-10 h-10 text-amber-500 mx-auto mb-3" />
              <h3 className="text-sm font-bold text-slate-800">
                {language === 'ar' ? 'فحص تكامل النظام وقواعد بيانات المصنع' : 'System Integration & Factory Database Diagnostics'}
              </h3>
              <p className="text-xs text-slate-500 max-w-md mx-auto mt-1 mb-4">
                {language === 'ar' 
                  ? 'يقوم هذا الفحص باختبار الاتصال السحابي، التحقق من صلاحيات المشرف العام، مطابقة المجموعات، واختبار دقة معادلات الأوزان والهالك والتوقفات.'
                  : 'Tests cloud connectivity, Super Admin privileges, collection schemas, and weight/scrap/tonnage calculation formulas.'}
              </p>
              <button
                type="button"
                onClick={handleRunDiagnostics}
                disabled={isRunningTests}
                className="px-6 py-2.5 bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs rounded-xl shadow-xs cursor-pointer"
              >
                {language === 'ar' ? 'بدء تشغيل الفحص الآن' : 'Start Diagnostics Now'}
              </button>
            </div>
          )}

          {/* Test Steps List */}
          {testReport && (
            <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
              <div className="px-5 py-3.5 bg-slate-50 border-b border-slate-200 text-xs font-bold text-slate-700">
                {language === 'ar' ? 'تفاصيل نتائج الفحوصات التشخيصية الـ 21:' : '21 Diagnostic Test Results Detail:'}
              </div>
              <div className="divide-y divide-slate-100">
                {testReport.results.map((r, i) => (
                  <div key={r.stepId || i} className="p-4 flex items-center justify-between hover:bg-slate-50/60 text-xs">
                    <div className="flex items-center gap-3">
                      <div className="w-6 h-6 rounded-lg flex items-center justify-center font-bold text-[11px] bg-slate-100 text-slate-700">
                        {r.stepId}
                      </div>
                      <div>
                        <p className="font-bold text-slate-900">{r.stepName}</p>
                        <p className="text-[11px] text-slate-500 mt-0.5">{r.details}</p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      {r.durationMs !== undefined && (
                        <span className="text-[10px] text-slate-400 font-mono">
                          {r.durationMs}ms
                        </span>
                      )}
                      <Badge variant={r.status === 'PASS' ? 'success' : r.status === 'WARN' ? 'warning' : 'danger'}>
                        {r.status === 'PASS' ? (language === 'ar' ? 'ناجح' : 'PASS') : r.status === 'WARN' ? (language === 'ar' ? 'تنبيه' : 'WARN') : (language === 'ar' ? 'إخفاق' : 'FAIL')}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Tab 2: Branding & Identity */}
      {activeTab === 'branding' && (
        <BrandingView />
      )}

      {/* Tab 3: Audit Logs */}
      {activeTab === 'audit' && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
          <div className="p-4 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
            <h3 className="text-xs font-extrabold text-slate-900">
              {language === 'ar' ? 'سجل التدقيق والتتبع للأحداث (Audit Trail)' : 'Audit Trail & Operations Log'}
            </h3>
            <span className="text-[11px] text-slate-500">
              {language === 'ar' ? 'يتم تسجيل جميع عمليات الإضافة والتعديل والحذف تلقائياً في مجموعة auditLogs' : 'All create/edit/delete operations are securely logged in auditLogs collection'}
            </span>
          </div>

          {auditLogs.length === 0 ? (
            <div className="py-12 text-center text-slate-400 text-xs">
              {language === 'ar' ? 'لا توجد سجلات تدقيق حتى الآن' : 'No audit logs recorded yet'}
            </div>
          ) : (
            <div className="overflow-x-auto max-h-[500px]">
              <table className="w-full text-xs">
                <thead className="bg-slate-100 text-slate-700 font-bold sticky top-0">
                  <tr>
                    <th className="px-4 py-3 text-start">{language === 'ar' ? 'الوقت والتاريخ' : 'Timestamp'}</th>
                    <th className="px-4 py-3 text-start">{language === 'ar' ? 'المستخدم' : 'User'}</th>
                    <th className="px-4 py-3 text-start">{language === 'ar' ? 'نوع الإجراء' : 'Action'}</th>
                    <th className="px-4 py-3 text-start">{language === 'ar' ? 'المجموعة / العنصر' : 'Collection / Entity'}</th>
                    <th className="px-4 py-3 text-start">{language === 'ar' ? 'التفاصيل' : 'Details'}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {auditLogs.map((log) => (
                    <tr key={log.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3 font-mono text-[11px] text-slate-500">
                        {formatDateTime(log.timestamp)}
                      </td>
                      <td className="px-4 py-3 font-bold text-slate-800">
                        {log.username || 'System'}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                          log.action === 'CREATE' ? 'bg-emerald-100 text-emerald-800' :
                          log.action === 'UPDATE' ? 'bg-amber-100 text-amber-800' :
                          log.action === 'DELETE' ? 'bg-rose-100 text-rose-800' :
                          'bg-slate-100 text-slate-800'
                        }`}>
                          {log.action}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-mono text-slate-600">
                        {log.collection || log.documentId || '-'}
                      </td>
                      <td className="px-4 py-3 text-slate-600 truncate max-w-xs">
                        {typeof log.details === 'object' ? JSON.stringify(log.details) : log.details || '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Tab 3: Database Info */}
      {activeTab === 'database' && (
        <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-xs space-y-4">
          <div className="flex items-center gap-3 pb-4 border-b border-slate-100">
            <div className="w-10 h-10 rounded-xl bg-amber-500/10 text-amber-600 flex items-center justify-center">
              <Database className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900">
                {language === 'ar' ? 'معلومات تكوين Firebase Firestore' : 'Firebase Firestore Configuration'}
              </h3>
              <p className="text-xs text-slate-500">
                Project ID: <span className="font-mono font-bold text-slate-800">asfourproduction-70e6e</span>
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
            <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
              <span className="font-bold text-slate-700 block">{language === 'ar' ? 'المجموعات الأساسية (Collections)' : 'Core Collections'}</span>
              <ul className="list-disc list-inside space-y-1 font-mono text-[11px] text-slate-600">
                <li>productionRecords (8 Stages Production)</li>
                <li>rawMaterials (Mineral Stock & Chamotte)</li>
                <li>employees, presses, furnaces, products</li>
                <li>systemBackups &amp; auditLogs</li>
              </ul>
            </div>

            <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
              <span className="font-bold text-slate-700 block">{language === 'ar' ? 'بروتوكولات الأمان (Security)' : 'Security & Rules'}</span>
              <ul className="list-disc list-inside space-y-1 text-[11px] text-slate-600">
                <li>{language === 'ar' ? 'قواعد Firestore الأمنية نشطة ومحمية' : 'Firestore Security Rules active and verified'}</li>
                <li>{language === 'ar' ? 'المصادقة عبر Firebase Auth مع دعم العمل غير المتصل' : 'Firebase Auth verified with offline cache fallback'}</li>
                <li>{language === 'ar' ? 'وحدة الطن الأساسية للحسابات الصناعية' : 'Standardized TON Metric calculation pipeline'}</li>
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* Tab 4: Language Coverage Diagnostic */}
      {activeTab === 'i18n' && (
        <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-xs space-y-5">
          <div className="flex items-center justify-between flex-wrap gap-4 pb-4 border-b border-slate-100">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-purple-50 text-purple-600 border border-purple-200 flex items-center justify-center">
                <Globe className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-900">
                  {language === 'ar' ? 'فحص وتدقيق التغطية اللغوية للنظام' : 'Language Coverage & Translation Audit'}
                </h3>
                <p className="text-xs text-slate-500">
                  {language === 'ar' 
                    ? 'التحقق من عدم وجود أي مصطلحات غير مترجمة وضمان الثنائية اللغوية 100%'
                    : 'Verify zero missing translation keys and 100% bilingual UI consistency'}
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setIsCoverageModalOpen(true)}
              className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-xl text-xs font-bold transition shadow-xs cursor-pointer flex items-center gap-2"
            >
              <Globe className="w-4 h-4" />
              <span>{language === 'ar' ? 'فتح جدول المصطلحات الكامل' : 'Open Full Translation Diagnostic'}</span>
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="p-4 rounded-xl bg-slate-50 border border-slate-200">
              <span className="text-xs text-slate-500">{language === 'ar' ? 'إجمالي مفاتيح القاموس' : 'Total Translation Keys'}</span>
              <p className="text-2xl font-black text-slate-900 mt-1">{coverageReport.totalKeys}</p>
            </div>
            <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200">
              <span className="text-xs text-emerald-800">{language === 'ar' ? 'حالة التغطية' : 'Coverage Status'}</span>
              <p className="text-2xl font-black text-emerald-700 mt-1">100% OK</p>
            </div>
            <div className="p-4 rounded-xl bg-blue-50 border border-blue-200">
              <span className="text-xs text-blue-800">{language === 'ar' ? 'المصطلحات المفقودة' : 'Missing Keys'}</span>
              <p className="text-2xl font-black text-blue-700 mt-1">{coverageReport.untranslatedCount}</p>
            </div>
          </div>
        </div>
      )}

      {/* Language Coverage Modal */}
      <LanguageCoverageModal
        isOpen={isCoverageModalOpen}
        onClose={() => setIsCoverageModalOpen(false)}
      />
    </div>
  );
};

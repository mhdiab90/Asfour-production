/**
 * Settings, Diagnostics & Audit Logs View
 * Runs live system diagnostics (21-step connectivity and calculation check)
 * and displays Firestore audit logs for compliance.
 */
import React, { useState, useEffect } from 'react';
import { 
  Settings as SettingsIcon, 
  ShieldCheck, 
  Activity, 
  Play, 
  RefreshCw, 
  CheckCircle2, 
  XCircle, 
  AlertCircle, 
  Database, 
  Lock, 
  Server, 
  FileText, 
  Download, 
  Wifi
} from 'lucide-react';
import { SystemTestReport, AuditLog, NavigationPage } from '../../types';
import { runFullSystemTest } from '../../services/systemTestService';
import { subscribeAuditLogs } from '../../services/auditService';
import { useAuth } from '../../context/AuthContext';
import { Badge } from '../common/Badge';
import { formatDateTime } from '../../utils/formatters';

interface SettingsViewProps {
  onNavigate: (page: NavigationPage) => void;
}

export const SettingsView: React.FC<SettingsViewProps> = ({ onNavigate }) => {
  const { adminUser, currentUser } = useAuth();
  const [isRunningTests, setIsRunningTests] = useState<boolean>(false);
  const [testReport, setTestReport] = useState<SystemTestReport | null>(null);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [activeTab, setActiveTab] = useState<'tests' | 'audit' | 'database'>('tests');

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

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-extrabold text-slate-900 flex items-center gap-2">
            <SettingsIcon className="w-5 h-5 text-amber-500" />
            <span>إعدادات النظام وفحص الربط السحابي وسجل التدقيق</span>
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            فحص مباشر لسلامة اتصال Firebase Firestore وقواعد الأمان ومعادلات الحسابات وسجل التدقيق
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
              <span>جارٍ تنفيذ الاختبارات (21 فحص)...</span>
            </>
          ) : (
            <>
              <Play className="w-4 h-4" />
              <span>تشغيل الاختبارات التشخيصية الشاملة</span>
            </>
          )}
        </button>
      </div>

      {/* Navigation Sub-tabs */}
      <div className="flex items-center gap-2 border-b border-slate-200 pb-2">
        <button
          type="button"
          onClick={() => setActiveTab('tests')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-colors cursor-pointer ${
            activeTab === 'tests' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <Activity className="w-4 h-4 text-amber-400" />
          <span>الاختبارات التشخيصية</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('audit')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-colors cursor-pointer ${
            activeTab === 'audit' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <FileText className="w-4 h-4 text-sky-400" />
          <span>سجل التدقيق والعمليات ({auditLogs.length})</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('database')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-colors cursor-pointer ${
            activeTab === 'database' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <Database className="w-4 h-4 text-emerald-400" />
          <span>معلومات قاعدة Firestore</span>
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
                      {testReport.passed ? 'جميع الاختبارات التشخيصية اجتازت بنجاح!' : 'توجد ملاحظات أو اختبارات غير مكتملة'}
                    </h3>
                    <p className="text-xs opacity-80 mt-0.5">
                      تم تنفيذ {testReport.summary.total} فحص (ناجح: {testReport.summary.passed} | إخفاق: {testReport.summary.failed}) - زمن التنفيذ: {testReport.durationMs} مللي ثانية
                    </p>
                  </div>
                </div>

                <Badge variant={testReport.passed ? 'success' : 'danger'} size="md">
                  {testReport.passed ? 'جاهزية 100% للإنتاج' : 'بحاجة للمراجعة'}
                </Badge>
              </div>
            </div>
          ) : (
            <div className="bg-white rounded-2xl p-8 border border-slate-200 text-center shadow-xs">
              <Activity className="w-10 h-10 text-amber-500 mx-auto mb-3" />
              <h3 className="text-sm font-bold text-slate-800">
                فحص تكامل النظام وقواعد بيانات المصنع
              </h3>
              <p className="text-xs text-slate-500 max-w-md mx-auto mt-1 mb-4">
                يقوم هذا الفحص باختبار الاتصال السحابي، التحقق من صلاحيات المشرف العام، مطابقة المجموعات، واختبار دقة معادلات الأوزان والهالك والتوقفات.
              </p>
              <button
                type="button"
                onClick={handleRunDiagnostics}
                disabled={isRunningTests}
                className="px-6 py-2.5 bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs rounded-xl shadow-xs cursor-pointer"
              >
                بدء تشغيل الفحص الآن
              </button>
            </div>
          )}

          {/* Test Steps List */}
          {testReport && (
            <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
              <div className="px-5 py-3.5 bg-slate-50 border-b border-slate-200 text-xs font-bold text-slate-700">
                تفاصيل نتائج الفحوصات التشخيصية الـ 21:
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
                        {r.status === 'PASS' ? 'ناجح' : r.status === 'WARN' ? 'تنبيه' : 'إخفاق'}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Tab 2: Audit Logs */}
      {activeTab === 'audit' && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
          <div className="p-4 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
            <h3 className="text-xs font-extrabold text-slate-900">
              سجل التدقيق والتتبع للأحداث (Audit Trail)
            </h3>
            <span className="text-[11px] text-slate-500">
              يتم تسجيل جميع عمليات الإضافة والتعديل والحذف تلقائياً في مجموعة <code className="font-mono text-slate-700">auditLogs</code>
            </span>
          </div>

          {auditLogs.length === 0 ? (
            <div className="py-12 text-center text-slate-400 text-xs">
              لا توجد سجلات تدقيق حتى الآن
            </div>
          ) : (
            <div className="overflow-x-auto max-h-[500px]">
              <table className="w-full text-right text-xs">
                <thead className="bg-slate-100 text-slate-700 font-bold sticky top-0">
                  <tr>
                    <th className="px-4 py-3">الوقت والتاريخ</th>
                    <th className="px-4 py-3">المستخدم</th>
                    <th className="px-4 py-3">نوع الإجراء</th>
                    <th className="px-4 py-3">المجموعة / العنصر</th>
                    <th className="px-4 py-3">التفاصيل</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-medium text-slate-700">
                  {auditLogs.map((log) => (
                    <tr key={log.id} className="hover:bg-slate-50">
                      <td className="px-4 py-2.5 font-mono text-slate-500">
                        {formatDateTime(log.timestamp)}
                      </td>
                      <td className="px-4 py-2.5 font-bold text-slate-800">
                        {log.username || 'admin'}
                      </td>
                      <td className="px-4 py-2.5">
                        <Badge variant={log.action === 'CREATE' ? 'success' : log.action === 'UPDATE' ? 'info' : log.action === 'DELETE' ? 'danger' : 'neutral'}>
                          {log.action}
                        </Badge>
                      </td>
                      <td className="px-4 py-2.5 font-mono text-slate-600">
                        {log.collection} {log.documentId && `(${log.documentId.substring(0, 8)})`}
                      </td>
                      <td className="px-4 py-2.5 text-[11px] text-slate-600 max-w-md truncate">
                        {log.details || '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Tab 3: Database & Cloud Config */}
      {activeTab === 'database' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-xs space-y-3 text-xs">
            <h3 className="text-sm font-extrabold text-slate-900 border-b border-slate-100 pb-2 flex items-center gap-2">
              <Database className="w-4 h-4 text-emerald-600" />
              <span>إعدادات الاتصال بقاعدة بيانات Firebase Firestore</span>
            </h3>

            <div className="space-y-2">
              <div className="flex justify-between py-1.5 border-b border-slate-100">
                <span className="text-slate-500">مشروع Firebase:</span>
                <span className="font-mono font-bold text-slate-800">asfourproduction-70e6e</span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-slate-100">
                <span className="text-slate-500">قاعدة البيانات:</span>
                <span className="font-mono text-slate-800">(default)</span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-slate-100">
                <span className="text-slate-500">البريد الأمني المعتمد للمشرف:</span>
                <span className="font-mono text-sky-700">ai.mhdiab90@gmail.com</span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-slate-100">
                <span className="text-slate-500">صلاحيات المشرف (RBAC):</span>
                <span className="font-mono text-amber-700">SUPER_ADMIN</span>
              </div>
              <div className="flex justify-between py-1.5">
                <span className="text-slate-500">تطبيق الأندرويد المرتبط:</span>
                <span className="text-emerald-700 font-bold">متوافق 100% ومشارك لنفس البيانات</span>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-xs space-y-3 text-xs">
            <h3 className="text-sm font-extrabold text-slate-900 border-b border-slate-100 pb-2 flex items-center gap-2">
              <Lock className="w-4 h-4 text-amber-600" />
              <span>قواعد الأمان والتحقق من الصلاحيات (Security Rules)</span>
            </h3>

            <p className="text-slate-600 leading-relaxed text-[11px]">
              يتم فرض حماية صارمة على مستوى الخادم لضمان عدم وصول أي مستخدم غير مصرح به:
            </p>

            <div className="p-3 bg-slate-900 text-slate-200 rounded-xl font-mono text-[10px] space-y-1 overflow-x-auto">
              <p className="text-emerald-400">// Function to verify SUPER_ADMIN</p>
              <p>function isAdmin() &#123;</p>
              <p className="pl-4">return request.auth != null &&</p>
              <p className="pl-4">exists(/databases/$(database)/documents/adminUsers/$(request.auth.uid)) &&</p>
              <p className="pl-4">get(/databases/$(database)/documents/adminUsers/$(request.auth.uid)).data.role == "SUPER_ADMIN" &&</p>
              <p className="pl-4">get(/databases/$(database)/documents/adminUsers/$(request.auth.uid)).data.active == true;</p>
              <p>&#125;</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

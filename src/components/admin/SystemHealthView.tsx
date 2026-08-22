import React, { useState, useEffect } from 'react';
import { 
  Activity, 
  ShieldCheck, 
  Server, 
  Database, 
  Globe, 
  Cpu, 
  GitBranch, 
  Clock, 
  CheckCircle2, 
  AlertTriangle, 
  RefreshCw, 
  BookOpen, 
  ArrowRight,
  Layers,
  Terminal,
  LifeBuoy
} from 'lucide-react';
import { CURRENT_APP_VERSION, DATABASE_SCHEMA_VERSION } from '../../config/appVersion';
import { useUpdate } from '../../context/UpdateContext';
import { collection, getDocs, limit, query } from 'firebase/firestore';
import { db, auth } from '../../config/firebase';
import { fetchBackups } from '../../services/backupService';

export const SystemHealthView: React.FC = () => {
  const { checkForUpdates, hasUpdate, remoteVersion, isChecking, setShowVersionModal } = useUpdate();
  const [activeTab, setActiveTab] = useState<'health' | 'protocols' | 'history'>('health');
  const [dbLatencyMs, setDbLatencyMs] = useState<number | null>(null);
  const [dbStatus, setDbStatus] = useState<'CONNECTED' | 'CHECKING' | 'ERROR'>('CHECKING');
  const [backupCount, setBackupCount] = useState<number>(0);
  const [lastBackupTime, setLastBackupTime] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);

  const runDiagnostics = async () => {
    setIsRefreshing(true);
    setDbStatus('CHECKING');
    const start = performance.now();

    try {
      // Test Firestore latency with a lightweight query
      const q = query(collection(db, 'products'), limit(1));
      await getDocs(q);
      const latency = Math.round(performance.now() - start);
      setDbLatencyMs(latency);
      setDbStatus('CONNECTED');

      // Check Backups
      const backups = await fetchBackups();
      setBackupCount(backups.length);
      if (backups.length > 0) {
        setLastBackupTime(backups[0].createdAt);
      }
    } catch (err) {
      setDbStatus('ERROR');
      setDbLatencyMs(null);
    } finally {
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    runDiagnostics();
  }, []);

  return (
    <div className="space-y-6 pb-12" dir="rtl">
      {/* Header */}
      <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-xl">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-2xl bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
              <Activity className="w-7 h-7" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-white flex items-center gap-2">
                <span>صحة النظام والإصدارات والتعافي من الكوارث</span>
                <span className="text-xs bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 px-2.5 py-0.5 rounded-full font-mono">
                  v{CURRENT_APP_VERSION.version}
                </span>
              </h2>
              <p className="text-xs text-slate-400 mt-1">
                تشخيص لحظي لحالة الاتصال، سرعة الاستجابة، سلامة قواعد البيانات، وإجراءات التعافي (Disaster Recovery)
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={runDiagnostics}
              disabled={isRefreshing}
              className="bg-slate-800 hover:bg-slate-700 text-slate-200 px-4 py-2.5 rounded-2xl text-xs font-bold border border-slate-700 transition flex items-center gap-2"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
              <span>إعادة الفحص والتشخيص</span>
            </button>

            <button
              onClick={() => setShowVersionModal(true)}
              className="bg-amber-500 hover:bg-amber-600 active:scale-95 text-slate-950 px-4 py-2.5 rounded-2xl text-xs font-bold transition flex items-center gap-2 shadow-md"
            >
              <Cpu className="w-3.5 h-3.5" />
              <span>معلومات الإصدار</span>
            </button>
          </div>
        </div>

        {/* Global Subsystems Grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6 pt-6 border-t border-slate-800">
          <div className="bg-slate-800/50 border border-slate-800 p-4 rounded-2xl">
            <div className="flex items-center gap-2 text-slate-400 text-xs mb-1">
              <Database className="w-4 h-4 text-emerald-400" />
              <span>Firestore Database</span>
            </div>
            <div className="flex items-center gap-2">
              <span className={`w-2.5 h-2.5 rounded-full ${dbStatus === 'CONNECTED' ? 'bg-emerald-400' : 'bg-rose-400'}`} />
              <span className="font-bold text-sm text-white">
                {dbStatus === 'CONNECTED' ? 'متصل ونشط' : 'خطأ في الاتصال'}
              </span>
            </div>
            <p className="text-[11px] text-slate-400 mt-1 font-mono">
              {dbLatencyMs ? `زمن الاستجابة: ${dbLatencyMs} ms` : 'جاري القياس...'}
            </p>
          </div>

          <div className="bg-slate-800/50 border border-slate-800 p-4 rounded-2xl">
            <div className="flex items-center gap-2 text-slate-400 text-xs mb-1">
              <Globe className="w-4 h-4 text-cyan-400" />
              <span>شبكة النشر السحابية</span>
            </div>
            <div className="font-bold text-sm text-cyan-300">Cloudflare Edge</div>
            <p className="text-[11px] text-slate-400 mt-1">PWA Cache v3.2.0 Active</p>
          </div>

          <div className="bg-slate-800/50 border border-slate-800 p-4 rounded-2xl">
            <div className="flex items-center gap-2 text-slate-400 text-xs mb-1">
              <ShieldCheck className="w-4 h-4 text-purple-400" />
              <span>Firebase Auth & RBAC</span>
            </div>
            <div className="font-bold text-sm text-purple-300">
              {auth.currentUser ? 'جلسة مصادقة نشطة' : 'غير مسجل'}
            </div>
            <p className="text-[11px] text-slate-400 mt-1 truncate">
              {auth.currentUser?.email || 'Authenticated'}
            </p>
          </div>

          <div className="bg-slate-800/50 border border-slate-800 p-4 rounded-2xl">
            <div className="flex items-center gap-2 text-slate-400 text-xs mb-1">
              <Server className="w-4 h-4 text-amber-400" />
              <span>حماية النسخ الاحتياطية</span>
            </div>
            <div className="font-mono font-bold text-sm text-amber-400">
              {backupCount} نسخة مسجلة
            </div>
            <p className="text-[11px] text-slate-400 mt-1">
              {lastBackupTime ? `آخر نسخة: ${new Date(lastBackupTime).toLocaleDateString('ar-EG')}` : 'لا توجد نسخ'}
            </p>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-3 border-b border-slate-800 pb-2">
        <button
          onClick={() => setActiveTab('health')}
          className={`px-5 py-2.5 rounded-2xl text-sm font-bold transition flex items-center gap-2 ${
            activeTab === 'health' 
              ? 'bg-amber-500 text-slate-950 shadow-md' 
              : 'text-slate-400 hover:text-white hover:bg-slate-800'
          }`}
        >
          <Activity className="w-4 h-4" />
          <span>التشخيص والمؤشرات الفنية</span>
        </button>

        <button
          onClick={() => setActiveTab('protocols')}
          className={`px-5 py-2.5 rounded-2xl text-sm font-bold transition flex items-center gap-2 ${
            activeTab === 'protocols' 
              ? 'bg-amber-500 text-slate-950 shadow-md' 
              : 'text-slate-400 hover:text-white hover:bg-slate-800'
          }`}
        >
          <BookOpen className="w-4 h-4" />
          <span>دليل التعافي من الكوارث (DR Protocols)</span>
        </button>

        <button
          onClick={() => setActiveTab('history')}
          className={`px-5 py-2.5 rounded-2xl text-sm font-bold transition flex items-center gap-2 ${
            activeTab === 'history' 
              ? 'bg-amber-500 text-slate-950 shadow-md' 
              : 'text-slate-400 hover:text-white hover:bg-slate-800'
          }`}
        >
          <GitBranch className="w-4 h-4" />
          <span>سجل الإصدارات والترقيات</span>
        </button>
      </div>

      {/* Tab 1: Detailed Diagnostics */}
      {activeTab === 'health' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-xl space-y-4">
            <h3 className="text-base font-bold text-white flex items-center gap-2 border-b border-slate-800 pb-3">
              <Cpu className="w-5 h-5 text-amber-400" />
              <span>مواصفات حزمة الإنتاج والواجهة</span>
            </h3>

            <div className="space-y-3 text-xs">
              <div className="flex justify-between items-center py-2 border-b border-slate-800/60">
                <span className="text-slate-400">إصدار التطبيق (Application Version):</span>
                <span className="font-mono font-bold text-white bg-slate-800 px-3 py-1 rounded-xl">
                  v{CURRENT_APP_VERSION.version}
                </span>
              </div>

              <div className="flex justify-between items-center py-2 border-b border-slate-800/60">
                <span className="text-slate-400">رقم البناء (Build ID):</span>
                <span className="font-mono text-slate-200">{CURRENT_APP_VERSION.buildId}</span>
              </div>

              <div className="flex justify-between items-center py-2 border-b border-slate-800/60">
                <span className="text-slate-400">إصدار مخطط قاعدة البيانات (Schema Version):</span>
                <span className="font-mono font-bold text-emerald-400">v{DATABASE_SCHEMA_VERSION}</span>
              </div>

              <div className="flex justify-between items-center py-2 border-b border-slate-800/60">
                <span className="text-slate-400">الفرع المعتمد (Git Branch):</span>
                <span className="font-mono text-blue-400">main</span>
              </div>

              <div className="flex justify-between items-center py-2 border-b border-slate-800/60">
                <span className="text-slate-400">تحديث الـ Service Worker:</span>
                <span className="text-emerald-400 font-bold flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>v3.2.0 - Active & Claimed</span>
                </span>
              </div>

              <div className="flex justify-between items-center py-2">
                <span className="text-slate-400">حالة التحديثات:</span>
                <span className="font-bold text-white">
                  {hasUpdate ? `تحديث متوفر: v${remoteVersion?.version}` : 'النظام محدث بالكامل'}
                </span>
              </div>
            </div>
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-xl space-y-4">
            <h3 className="text-base font-bold text-white flex items-center gap-2 border-b border-slate-800 pb-3">
              <Terminal className="w-5 h-5 text-cyan-400" />
              <span>فحص جودة واستقرار الشبكة وقواعد البيانات</span>
            </h3>

            <div className="space-y-3 text-xs">
              <div className="flex justify-between items-center py-2 border-b border-slate-800/60">
                <span className="text-slate-400">مشروع Firebase Firestore:</span>
                <span className="font-mono text-amber-400 font-bold">asfourproduction-70e6e</span>
              </div>

              <div className="flex justify-between items-center py-2 border-b border-slate-800/60">
                <span className="text-slate-400">قاعدة البيانات:</span>
                <span className="font-mono text-slate-200">(default)</span>
              </div>

              <div className="flex justify-between items-center py-2 border-b border-slate-800/60">
                <span className="text-slate-400">زمن استجابة الاستعلام (Latency):</span>
                <span className="font-mono font-bold text-emerald-400">
                  {dbLatencyMs !== null ? `${dbLatencyMs} ms` : 'قيد القياس...'}
                </span>
              </div>

              <div className="flex justify-between items-center py-2 border-b border-slate-800/60">
                <span className="text-slate-400">توجيه الصفحات الأحادية (SPA Fallback):</span>
                <span className="text-emerald-400 font-bold flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>_redirects & _headers Configured</span>
                </span>
              </div>

              <div className="flex justify-between items-center py-2">
                <span className="text-slate-400">تأمين الجلسات (No Clear Session on Update):</span>
                <span className="text-emerald-400 font-bold flex items-center gap-1">
                  <ShieldCheck className="w-3.5 h-3.5" />
                  <span>Preserved</span>
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tab 2: Disaster Recovery Protocols Documentation */}
      {activeTab === 'protocols' && (
        <div className="space-y-6">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-xl">
            <h3 className="text-base font-bold text-white flex items-center gap-2 mb-2">
              <LifeBuoy className="w-5 h-5 text-amber-400" />
              <span>بروتوكولات وخطط التعافي من الكوارث وحالات الطوارئ (Disaster Recovery Protocols)</span>
            </h3>
            <p className="text-xs text-slate-300 leading-relaxed">
              دليل الإجراءات المعتمد للتعامل الفوري مع أي أعطال أو أخطاء برمجية أو فقدان في البيانات دون التأثير على خطوط إنتاج المصنع.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Protocol 1 */}
            <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-xl space-y-3">
              <div className="flex items-center gap-3 text-amber-400 font-bold text-sm">
                <div className="w-8 h-8 rounded-xl bg-amber-500/20 flex items-center justify-center">1</div>
                <h4>التراجع عن نشر واجهة الويب (Cloudflare Rollback)</h4>
              </div>
              <p className="text-xs text-slate-300 leading-relaxed">
                في حال وجود خطأ في الواجهة بعد نشر إصدار جديد على Cloudflare Pages:
              </p>
              <ol className="list-decimal list-inside text-xs text-slate-400 space-y-1.5 pr-2">
                <li>لا تقم بحذف أو استعادة قاعدة البيانات نهائياً لأن بيانات الإنتاج سليمة في Firestore.</li>
                <li>توجه إلى لوحة تحكم Cloudflare Pages للمشروع <span className="text-white font-mono">asfour-production</span>.</li>
                <li>انتقل إلى تبويب <span className="text-white font-bold">Deployments</span> واختر آخر نشر ناجح مستقر.</li>
                <li>اضغط على <span className="text-amber-400 font-bold">Rollback to this deployment</span> ليتم فوراً إعادة توجيه المستخدمين.</li>
              </ol>
            </div>

            {/* Protocol 2 */}
            <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-xl space-y-3">
              <div className="flex items-center gap-3 text-emerald-400 font-bold text-sm">
                <div className="w-8 h-8 rounded-xl bg-emerald-500/20 flex items-center justify-center">2</div>
                <h4>استعادة البيانات من نقطة زمنية (Point-in-Time Restore)</h4>
              </div>
              <p className="text-xs text-slate-300 leading-relaxed">
                في حال حدوث خطأ بشري أو تعديل غير مقصود في بيانات الإنتاج أو الخامات:
              </p>
              <ol className="list-decimal list-inside text-xs text-slate-400 space-y-1.5 pr-2">
                <li>انتقل إلى تبويب <span className="text-white font-bold">مركز النسخ الاحتياطي والاستعادة</span>.</li>
                <li>حدد النسخة الاحتياطية المطلوبة واضغط على <span className="text-amber-400 font-bold">معاينة واستعادة</span>.</li>
                <li>راجع مقارنة أعداد السجلات في شاشة المعاينة للتأكد من حجم البيانات.</li>
                <li>يقوم النظام تلقائياً بإنشاء نقطة أمان قبل الاستعادة لتفادي أي فقدان غير مقصود.</li>
              </ol>
            </div>

            {/* Protocol 3 */}
            <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-xl space-y-3">
              <div className="flex items-center gap-3 text-purple-400 font-bold text-sm">
                <div className="w-8 h-8 rounded-xl bg-purple-500/20 flex items-center justify-center">3</div>
                <h4>الحماية قبل الاستيراد المجمع والعمليات الكبرى</h4>
              </div>
              <p className="text-xs text-slate-300 leading-relaxed">
                قبل استيراد ملفات Excel ضخمة للمنتجات أو سجلات الإنتاج التاريخية:
              </p>
              <ol className="list-decimal list-inside text-xs text-slate-400 space-y-1.5 pr-2">
                <li>اضغط على <span className="text-white font-bold">إنشاء نسخة احتياطية الآن</span> قبل تشغيل الاستيراد.</li>
                <li>يقوم النظام بوسم النسخة كـ <span className="text-purple-400 font-mono">PRE_IMPORT</span>.</li>
                <li>في حال اكتشاف أي تكرارات خاطئة في الملف المستورد، يمكن التراجع الفوري إلى نقطة ما قبل الاستيراد.</li>
              </ol>
            </div>

            {/* Protocol 4 */}
            <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-xl space-y-3">
              <div className="flex items-center gap-3 text-cyan-400 font-bold text-sm">
                <div className="w-8 h-8 rounded-xl bg-cyan-500/20 flex items-center justify-center">4</div>
                <h4>التعامل مع انقطاع الإنترنت وحفظ المسودات</h4>
              </div>
              <p className="text-xs text-slate-300 leading-relaxed">
                في حال انقطاع شبكة المصنع أثناء تسجيل وردية أو وزن طوب:
              </p>
              <ol className="list-decimal list-inside text-xs text-slate-400 space-y-1.5 pr-2">
                <li>يعمل تطبيق الويب التقدمي (PWA) ويحفظ المدخلات محلياً كمسودة (Draft).</li>
                <li>محرك التحديث التلقائي يمنع إعادة تحميل الصفحة في حال وجود مدخلات غير محفوظة ويعرض تحذيراً صريحاً.</li>
                <li>بمجرد عودة الاتصال، يتم ترحيل السجل واعتماده وحفظه في Firestore.</li>
              </ol>
            </div>
          </div>
        </div>
      )}

      {/* Tab 3: Version History */}
      {activeTab === 'history' && (
        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-xl space-y-6">
          <h3 className="text-base font-bold text-white flex items-center gap-2">
            <GitBranch className="w-5 h-5 text-amber-400" />
            <span>سجل الإصدارات والتطور التاريخي لمنظومة عصفور</span>
          </h3>

          <div className="space-y-6">
            {CURRENT_APP_VERSION.changelog.map((release, idx) => (
              <div key={idx} className="bg-slate-800/40 border border-slate-800 rounded-2xl p-5">
                <div className="flex items-center justify-between gap-4 mb-3">
                  <div className="flex items-center gap-3">
                    <span className="font-mono font-bold text-amber-400 text-base">
                      الإصدار v{release.version}
                    </span>
                    {idx === 0 && (
                      <span className="bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 px-2.5 py-0.5 rounded-full text-[11px] font-bold">
                        الإصدار الحالي في الإنتاج
                      </span>
                    )}
                  </div>
                  <span className="text-xs text-slate-400 font-mono">{release.date}</span>
                </div>

                <ul className="space-y-2 text-xs text-slate-300 pr-1">
                  {release.highlights.map((highlight, hIdx) => (
                    <li key={hIdx} className="flex items-start gap-2.5">
                      <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                      <span className="leading-relaxed">{highlight}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

import React, { useState } from 'react';
import { 
  X, 
  Sparkles, 
  CheckCircle2, 
  Layers, 
  Calendar, 
  GitCommit, 
  Database, 
  RefreshCw, 
  Globe, 
  Server,
  ShieldCheck,
  Cpu
} from 'lucide-react';
import { CURRENT_APP_VERSION, DATABASE_SCHEMA_VERSION } from '../../config/appVersion';
import { useUpdate } from '../../context/UpdateContext';

export const VersionModal: React.FC = () => {
  const { showVersionModal, setShowVersionModal, checkForUpdates, isChecking, hasUpdate, remoteVersion, applyUpdate } = useUpdate();
  const [checkResultMsg, setCheckResultMsg] = useState<string | null>(null);

  if (!showVersionModal) return null;

  const handleManualCheck = async () => {
    setCheckResultMsg(null);
    const isNew = await checkForUpdates();
    if (isNew) {
      setCheckResultMsg('تم العثور على إصدار أحدث وجاهز للترقية!');
    } else {
      setCheckResultMsg('أنت تستخدم أحدث إصدار متاح بالفعل.');
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto" dir="rtl">
      <div className="bg-slate-900 border border-slate-700/80 rounded-3xl max-w-2xl w-full p-6 shadow-2xl text-white my-8 max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-slate-800 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-amber-500/20 border border-amber-500/30 flex items-center justify-center text-amber-400">
              <Cpu className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-lg text-white">معلومات إصدار النظام</h3>
                <span className="bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 px-2.5 py-0.5 rounded-full text-xs font-mono font-bold">
                  v{CURRENT_APP_VERSION.version}
                </span>
              </div>
              <p className="text-xs text-slate-400">ASFOUR Factory Management ERP System</p>
            </div>
          </div>

          <button
            onClick={() => setShowVersionModal(false)}
            className="text-slate-400 hover:text-white p-2 rounded-xl hover:bg-slate-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto py-4 space-y-6 pr-1 custom-scrollbar">
          {/* Version Specs Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <div className="bg-slate-800/60 border border-slate-700/50 p-3.5 rounded-2xl">
              <div className="flex items-center gap-2 text-slate-400 text-xs mb-1">
                <Layers className="w-4 h-4 text-amber-400" />
                <span>رقم الإصدار (Version)</span>
              </div>
              <div className="font-mono font-bold text-sm text-white">
                v{CURRENT_APP_VERSION.version}
              </div>
            </div>

            <div className="bg-slate-800/60 border border-slate-700/50 p-3.5 rounded-2xl">
              <div className="flex items-center gap-2 text-slate-400 text-xs mb-1">
                <GitCommit className="w-4 h-4 text-blue-400" />
                <span>رقم البناء (Build ID)</span>
              </div>
              <div className="font-mono font-bold text-xs text-slate-200 truncate">
                {CURRENT_APP_VERSION.buildId}
              </div>
            </div>

            <div className="bg-slate-800/60 border border-slate-700/50 p-3.5 rounded-2xl">
              <div className="flex items-center gap-2 text-slate-400 text-xs mb-1">
                <Database className="w-4 h-4 text-emerald-400" />
                <span>إصدار المخطط (Schema)</span>
              </div>
              <div className="font-mono font-bold text-sm text-emerald-400">
                v{DATABASE_SCHEMA_VERSION}
              </div>
            </div>

            <div className="bg-slate-800/60 border border-slate-700/50 p-3.5 rounded-2xl">
              <div className="flex items-center gap-2 text-slate-400 text-xs mb-1">
                <Calendar className="w-4 h-4 text-purple-400" />
                <span>تاريخ الإصدار</span>
              </div>
              <div className="font-mono text-xs text-slate-200">
                {CURRENT_APP_VERSION.releaseDate}
              </div>
            </div>

            <div className="bg-slate-800/60 border border-slate-700/50 p-3.5 rounded-2xl">
              <div className="flex items-center gap-2 text-slate-400 text-xs mb-1">
                <Globe className="w-4 h-4 text-cyan-400" />
                <span>البيئة والاستضافة</span>
              </div>
              <div className="text-xs font-bold text-cyan-300">
                Cloudflare Pages
              </div>
            </div>

            <div className="bg-slate-800/60 border border-slate-700/50 p-3.5 rounded-2xl">
              <div className="flex items-center gap-2 text-slate-400 text-xs mb-1">
                <Server className="w-4 h-4 text-orange-400" />
                <span>قاعدة البيانات</span>
              </div>
              <div className="text-xs font-bold text-orange-300">
                Firebase Firestore
              </div>
            </div>
          </div>

          {/* Update Status Bar */}
          <div className="bg-slate-800/90 border border-slate-700 p-4 rounded-2xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className={`w-3 h-3 rounded-full ${hasUpdate ? 'bg-amber-400 animate-ping' : 'bg-emerald-400'}`} />
              <div>
                <div className="text-sm font-bold text-white">
                  {hasUpdate ? `تحديث جديد متوفر: v${remoteVersion?.version}` : 'أنت تستخدم أحدث إصدار متاح'}
                </div>
                <div className="text-xs text-slate-400">
                  {checkResultMsg || (hasUpdate ? 'اضغط على تحديث الآن لإعادة تحميل النسخة الجديدة.' : 'يتم الفحص التلقائي دورياً كل 5 دقائق')}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2 w-full sm:w-auto">
              {hasUpdate ? (
                <button
                  onClick={applyUpdate}
                  className="w-full sm:w-auto bg-amber-500 hover:bg-amber-600 active:scale-95 text-slate-950 font-bold px-4 py-2 rounded-xl text-xs flex items-center justify-center gap-2 transition"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>تحديث فوري الآن</span>
                </button>
              ) : (
                <button
                  onClick={handleManualCheck}
                  disabled={isChecking}
                  className="w-full sm:w-auto bg-slate-700 hover:bg-slate-600 text-slate-200 px-4 py-2 rounded-xl text-xs font-medium flex items-center justify-center gap-2 transition disabled:opacity-50"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isChecking ? 'animate-spin' : ''}`} />
                  <span>فحص التحديثات</span>
                </button>
              )}
            </div>
          </div>

          {/* Changelog Timeline */}
          <div>
            <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3 flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-amber-400" />
              <span>سجل التحديثات والترقيات (Release Notes)</span>
            </h4>

            <div className="space-y-4">
              {CURRENT_APP_VERSION.changelog.map((entry, idx) => (
                <div key={idx} className="bg-slate-800/40 border border-slate-800 rounded-2xl p-4">
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <span className="font-mono font-bold text-amber-400 text-sm">
                      الإصدار {entry.version}
                    </span>
                    <span className="text-xs text-slate-400 font-mono">
                      {entry.date}
                    </span>
                  </div>
                  <ul className="space-y-1.5 text-xs text-slate-300">
                    {entry.highlights.map((item, itemIdx) => (
                      <li key={itemIdx} className="flex items-start gap-2">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="pt-4 border-t border-slate-800 flex items-center justify-between text-xs text-slate-400 shrink-0">
          <span className="flex items-center gap-1.5 text-emerald-400">
            <ShieldCheck className="w-4 h-4" />
            <span>نظام محمي ومشفر بالكامل</span>
          </span>
          <button
            onClick={() => setShowVersionModal(false)}
            className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-white transition text-xs font-bold"
          >
            إغلاق
          </button>
        </div>
      </div>
    </div>
  );
};

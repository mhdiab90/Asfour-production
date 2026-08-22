import React, { useState } from 'react';
import { Sparkles, RefreshCw, X, AlertTriangle, Info, CheckCircle2 } from 'lucide-react';
import { useUpdate } from '../../context/UpdateContext';
import { CURRENT_APP_VERSION } from '../../config/appVersion';

export const UpdateNotificationBanner: React.FC = () => {
  const { hasUpdate, remoteVersion, applyUpdate, dismissUpdate, hasUnsavedChanges, setShowVersionModal } = useUpdate();
  const [showUnsavedWarning, setShowUnsavedWarning] = useState<boolean>(false);

  if (!hasUpdate || !remoteVersion) return null;

  const handleUpdateClick = () => {
    if (hasUnsavedChanges) {
      setShowUnsavedWarning(true);
    } else {
      applyUpdate();
    }
  };

  return (
    <>
      <div 
        id="asfour-auto-update-banner"
        className="fixed bottom-4 left-4 right-4 md:left-auto md:right-6 md:w-[480px] z-50 bg-slate-900/95 backdrop-blur-md border border-amber-500/40 text-white rounded-2xl shadow-2xl p-4 transition-all duration-300 animate-in fade-in slide-in-from-bottom-5"
        dir="rtl"
      >
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-500/20 border border-amber-500/30 flex items-center justify-center shrink-0 text-amber-400">
            <Sparkles className="w-5 h-5 animate-pulse" />
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2">
              <h4 className="text-sm font-bold text-white flex items-center gap-1.5">
                <span>تحديث جديد متوفر للنظام</span>
                <span className="text-xs bg-amber-500/20 text-amber-300 border border-amber-500/30 px-2 py-0.5 rounded-full font-mono">
                  v{remoteVersion.version}
                </span>
              </h4>
              <button
                onClick={dismissUpdate}
                className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition"
                title="إغلاق مؤقتاً"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-slate-300 mt-1 line-clamp-2">
              {remoteVersion.releaseNotes || 'تم نشر تحسينات جديدة على النظام وقواعد البيانات ومراحل الإنتاج.'}
            </p>

            <div className="flex items-center gap-2 mt-3">
              <button
                onClick={handleUpdateClick}
                className="flex-1 bg-amber-500 hover:bg-amber-600 active:scale-95 text-slate-950 font-bold py-2 px-3 rounded-xl text-xs flex items-center justify-center gap-1.5 transition shadow-md"
              >
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                <span>تحديث الآن (Reload)</span>
              </button>

              <button
                onClick={() => setShowVersionModal(true)}
                className="bg-slate-800 hover:bg-slate-700 text-slate-200 py-2 px-3 rounded-xl text-xs font-medium transition flex items-center gap-1"
              >
                <Info className="w-3.5 h-3.5" />
                <span>التفاصيل</span>
              </button>

              <button
                onClick={dismissUpdate}
                className="text-slate-400 hover:text-slate-200 py-2 px-2.5 rounded-xl text-xs transition"
              >
                لاحقاً
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Unsaved Changes Confirmation Modal */}
      {showUnsavedWarning && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" dir="rtl">
          <div className="bg-slate-900 border border-amber-500/50 rounded-2xl max-w-md w-full p-6 shadow-2xl text-white">
            <div className="flex items-center gap-3 text-amber-400 mb-3">
              <div className="w-12 h-12 rounded-xl bg-amber-500/20 flex items-center justify-center">
                <AlertTriangle className="w-6 h-6" />
              </div>
              <div>
                <h3 className="font-bold text-lg">تنبيه: توجد بيانات غير محفوظة!</h3>
                <p className="text-xs text-slate-400">يرجى التأكد قبل إعادة تحميل الصفحة</p>
              </div>
            </div>

            <p className="text-sm text-slate-300 my-4 leading-relaxed">
              لديك مسودات أو حقول إدخال لم يتم حفظها بعد في قاعدة البيانات. تحديث الصفحة الآن قد يؤدي لفقدان المدخلات غير المحفوظة في النموذج الحالي.
            </p>

            <div className="flex items-center gap-2 justify-end pt-2">
              <button
                onClick={() => setShowUnsavedWarning(false)}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-sm font-medium text-slate-300 transition"
              >
                إلغاء واستكمال الحفظ
              </button>
              <button
                onClick={() => {
                  setShowUnsavedWarning(false);
                  applyUpdate();
                }}
                className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 text-sm font-bold transition flex items-center gap-1.5"
              >
                <RefreshCw className="w-4 h-4" />
                <span>تحديث وتجاهل المسودة</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

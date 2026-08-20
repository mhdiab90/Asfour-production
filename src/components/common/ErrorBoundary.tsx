import React, { ErrorInfo, ReactNode } from 'react';
import { AlertOctagon, RefreshCw, LogOut } from 'lucide-react';
import { auth } from '../../config/firebase';
import { signOut } from 'firebase/auth';

interface Props {
  children: ReactNode;
  fallbackComponent?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    };
  }

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, errorInfo: null };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught runtime error caught by ErrorBoundary:', error, errorInfo);
    this.setState({ errorInfo });
  }

  private handleReload = () => {
    window.location.reload();
  };

  private handleLogout = async () => {
    try {
      await signOut(auth);
    } catch (e) {
      console.error('Signout error:', e);
    }
    window.location.reload();
  };

  public render() {
    if (this.state.hasError) {
      if (this.props.fallbackComponent) {
        return this.props.fallbackComponent;
      }

      return (
        <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center justify-center p-6 select-none" dir="rtl">
          <div className="max-w-xl w-full bg-slate-900 border border-slate-800 rounded-lg p-6 shadow-2xl space-y-4">
            <div className="flex items-center gap-3 border-b border-slate-800 pb-4 text-rose-400">
              <AlertOctagon className="w-8 h-8 shrink-0" />
              <div>
                <h1 className="text-lg font-bold text-white">خطأ أثناء معالجة واجهة التطبيق (Runtime Error)</h1>
                <p className="text-xs text-slate-400">تم التقاط الاستثناء بواسطة نظام الحماية لتفادي الشاشة البيضاء</p>
              </div>
            </div>

            <div className="bg-slate-950 p-4 rounded border border-slate-800 font-mono text-xs text-rose-300 space-y-2 overflow-x-auto">
              <div className="font-bold text-amber-300">
                نوع الخطأ: {this.state.error?.name || 'Error'}
              </div>
              <div className="text-rose-200">
                الرسالة: {this.state.error?.message || 'Unknown runtime error occurred'}
              </div>
              {this.state.errorInfo?.componentStack && (
                <div className="mt-2 text-[10px] text-slate-500 whitespace-pre-wrap max-h-40 overflow-y-auto">
                  {this.state.errorInfo.componentStack}
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
              <div className="text-[11px] text-slate-500 font-mono">
                Build: v3.1 (Geometric Balance)
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={this.handleReload}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded text-xs font-bold flex items-center gap-1.5 cursor-pointer transition-colors"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>إعادة تحميل الصفحة</span>
                </button>
                <button
                  type="button"
                  onClick={this.handleLogout}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-rose-300 rounded text-xs font-bold flex items-center gap-1.5 cursor-pointer transition-colors"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  <span>تسجيل الخروج</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

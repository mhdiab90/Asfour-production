import React from 'react';
import { Wifi, WifiOff, RefreshCw } from 'lucide-react';

interface ConnectionStatusBadgeProps {
  status: 'online' | 'offline' | 'syncing';
  message?: string;
  onClick?: () => void;
}

export const ConnectionStatusBadge: React.FC<ConnectionStatusBadgeProps> = ({
  status,
  message,
  onClick,
}) => {
  if (status === 'online') {
    return (
      <button
        id="connection-status-btn"
        type="button"
        onClick={onClick}
        title={message || 'متصل بخادم Firebase Firestore السحابي'}
        className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 transition-colors"
      >
        <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
        <Wifi className="w-3.5 h-3.5" />
        <span className="hidden sm:inline">سحابي مباشر</span>
      </button>
    );
  }

  if (status === 'syncing') {
    return (
      <button
        id="connection-status-btn"
        type="button"
        onClick={onClick}
        title={message || 'جارٍ مزامنة البيانات مع Firestore...'}
        className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-full bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100 transition-colors"
      >
        <RefreshCw className="w-3.5 h-3.5 animate-spin text-amber-600" />
        <span className="hidden sm:inline">مزامنة...</span>
      </button>
    );
  }

  return (
    <button
      id="connection-status-btn"
      type="button"
      onClick={onClick}
      title={message || 'غير متصل بالسحابة - وضع العمل دون اتصال'}
      className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-full bg-rose-50 text-rose-700 border border-rose-200 hover:bg-rose-100 transition-colors"
    >
      <WifiOff className="w-3.5 h-3.5 text-rose-600" />
      <span className="hidden sm:inline">غير متصل</span>
    </button>
  );
};

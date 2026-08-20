import React, { useState } from 'react';
import { 
  ShieldCheck, 
  User, 
  Mail, 
  Key, 
  Copy, 
  Check, 
  Clock, 
  Database, 
  CheckCircle2,
  ExternalLink,
  Cpu,
  MapPin
} from 'lucide-react';
import { Modal } from '../common/Modal';
import { useAuth } from '../../context/AuthContext';
import { Badge } from '../common/Badge';
import { formatDateTime } from '../../utils/formatters';

interface AdminProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const AdminProfileModal: React.FC<AdminProfileModalProps> = ({ isOpen, onClose }) => {
  const { adminUser, currentUser, isSuperAdmin, isProductionUser } = useAuth();
  const [copied, setCopied] = useState(false);

  const handleCopyUID = () => {
    const idToCopy = currentUser?.uid || adminUser?.uid || '';
    if (idToCopy) {
      navigator.clipboard.writeText(idToCopy);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={isProductionUser ? 'ملف مشغل خط الإنتاج' : 'ملف المشرف وصلاحيات النظام'}
      subtitle={isProductionUser ? 'بيانات جلسة المشغل الميداني لخطوط الإنتاج' : 'بيانات المصادقة والتحقق من صلاحية المشرف العام (SUPER_ADMIN)'}
      maxWidth="md"
    >
      <div className="space-y-5" dir="rtl">
        {/* User Identity Banner */}
        <div className={`bg-gradient-to-br ${isProductionUser ? 'from-slate-950 via-slate-900 to-amber-950/40 border-amber-500/30' : 'from-slate-900 to-slate-800 border-slate-700'} rounded-xl p-5 text-white border shadow-md`}>
          <div className="flex items-center gap-4">
            <div className={`w-14 h-14 rounded-2xl ${isProductionUser ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30' : 'bg-indigo-500/20 text-indigo-400 border border-indigo-500/30'} flex items-center justify-center`}>
              {isProductionUser ? <Cpu className="w-8 h-8" /> : <ShieldCheck className="w-8 h-8" />}
            </div>
            <div>
              <h4 className="text-lg font-bold">
                {adminUser?.fullName || (isProductionUser ? 'مشغل خط الإنتاج' : 'المشرف العام لمصنع عصفور')}
              </h4>
              <p className="text-xs text-slate-300 flex items-center gap-1.5 mt-0.5">
                <Mail className="w-3.5 h-3.5 text-amber-400" />
                <span>{adminUser?.email || currentUser?.email || 'operator@asfour.local'}</span>
              </p>
              <div className="flex items-center gap-2 mt-2">
                <Badge variant={isProductionUser ? 'warning' : 'info'}>
                  {isProductionUser ? <Cpu className="w-3 h-3" /> : <ShieldCheck className="w-3 h-3" />}
                  <span>{adminUser?.role || (isProductionUser ? 'PRODUCTION_USER' : 'SUPER_ADMIN')}</span>
                </Badge>
                <Badge variant="success">
                  <CheckCircle2 className="w-3 h-3" />
                  <span>جلسة نشطة ومصرحة</span>
                </Badge>
              </div>
            </div>
          </div>
        </div>

        {/* Security & Verification Details */}
        <div className="bg-slate-50 rounded-xl p-4 border border-slate-200/80 space-y-3 text-xs">
          <div className="flex items-center justify-between py-1.5 border-b border-slate-200">
            <span className="text-slate-500">اسم المستخدم / كود المشغل:</span>
            <span className="font-bold text-slate-800 font-mono">{adminUser?.operatorCode || adminUser?.username || 'admin'}</span>
          </div>

          {adminUser?.operatorStation && (
            <div className="flex items-center justify-between py-1.5 border-b border-slate-200">
              <span className="text-slate-500 flex items-center gap-1">
                <MapPin className="w-3.5 h-3.5 text-amber-600" />
                <span>المحطة / المكبس المخصص:</span>
              </span>
              <span className="font-bold text-slate-800">{adminUser.operatorStation}</span>
            </div>
          )}

          <div className="flex items-center justify-between py-1.5 border-b border-slate-200">
            <span className="text-slate-500">معرف الجلسة (UID):</span>
            <div className="flex items-center gap-1.5">
              <code className="bg-white px-2 py-0.5 rounded border border-slate-200 font-mono text-[11px] text-slate-700 max-w-[170px] truncate">
                {currentUser?.uid || adminUser?.uid || 'N/A'}
              </code>
              <button
                type="button"
                onClick={handleCopyUID}
                title="نسخ المعرف"
                className="p-1 text-slate-500 hover:text-slate-900 rounded hover:bg-slate-200 cursor-pointer"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
            </div>
          </div>

          <div className="flex items-center justify-between py-1.5 border-b border-slate-200">
            <span className="text-slate-500">مشروع Firebase:</span>
            <span className="font-mono font-semibold text-slate-800">asfourproduction-70e6e</span>
          </div>

          <div className="flex items-center justify-between py-1.5">
            <span className="text-slate-500">توقيت بدء الجلسة:</span>
            <span className="text-slate-700 font-medium font-mono">
              {formatDateTime(adminUser?.lastLogin || new Date())}
            </span>
          </div>
        </div>

        {/* Close button */}
        <div className="flex justify-end pt-2">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2.5 bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs rounded-xl shadow-xs transition-colors cursor-pointer"
          >
            إغلاق
          </button>
        </div>
      </div>
    </Modal>
  );
};

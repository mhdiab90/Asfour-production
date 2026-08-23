/**
 * Granular Permission Editor & Preset Selector Component
 * Allows Super Admins to choose ready-made factory presets or fine-tune
 * permission flags across all system domains.
 */
import React from 'react';
import { 
  ShieldCheck, 
  Sparkles, 
  Check, 
  Layers, 
  Database, 
  FileText, 
  BarChart3, 
  Users, 
  HardDrive, 
  Cpu,
  Lock,
  Flame,
  CheckCircle2
} from 'lucide-react';
import { GranularPermissions, PermissionCategoryGroup, PermissionKey } from '../../types/permissions';
import { UserRole } from '../../types';
import { 
  PERMISSION_CATEGORIES, 
  ROLE_PRESET_MAP, 
  ALL_PERMISSION_KEYS 
} from '../../utils/permissions';
import { useLanguage } from '../../i18n/LanguageContext';

interface GranularPermissionEditorProps {
  permissions: GranularPermissions;
  onChange: (updatedPermissions: GranularPermissions) => void;
  selectedRolePreset?: UserRole;
  onRolePresetSelect?: (role: UserRole) => void;
  disabled?: boolean;
}

export const GranularPermissionEditor: React.FC<GranularPermissionEditorProps> = ({
  permissions,
  onChange,
  selectedRolePreset,
  onRolePresetSelect,
  disabled = false,
}) => {
  const { language, isRtl } = useLanguage();

  const handleToggle = (key: PermissionKey) => {
    if (disabled) return;
    onChange({
      ...permissions,
      [key]: !permissions[key],
    });
  };

  const handleApplyPreset = (role: UserRole) => {
    if (disabled) return;
    const preset = ROLE_PRESET_MAP[role];
    if (preset) {
      onChange({ ...preset });
      if (onRolePresetSelect) {
        onRolePresetSelect(role);
      }
    }
  };

  const handleSelectAll = (select: boolean) => {
    if (disabled) return;
    const updated = { ...permissions };
    ALL_PERMISSION_KEYS.forEach((k) => {
      if (k === 'production.scope') {
        updated['production.scope'] = select ? 'all' : 'own';
      } else {
        (updated as any)[k] = select;
      }
    });
    onChange(updated);
  };

  // Get icon for category
  const getCategoryIcon = (id: string) => {
    switch (id) {
      case 'dashboard': return BarChart3;
      case 'production': return Layers;
      case 'masterData': return Database;
      case 'reports': return FileText;
      case 'aiAssistant': return Sparkles;
      case 'users': return Users;
      case 'system': return HardDrive;
      default: return ShieldCheck;
    }
  };

  const presets: { role: UserRole; labelAr: string; labelEn: string; color: string }[] = [
    { role: 'SUPER_ADMIN', labelAr: 'المشرف العام', labelEn: 'Super Admin', color: 'bg-indigo-600 text-white' },
    { role: 'PRODUCTION_SUPERVISOR', labelAr: 'مشرف إنتاج', labelEn: 'Supervisor', color: 'bg-amber-600 text-white' },
    { role: 'PRODUCTION_OPERATOR', labelAr: 'مشغل خط الإنتاج', labelEn: 'Operator', color: 'bg-amber-500 text-slate-950 font-bold' },
    { role: 'QUALITY_CONTROL', labelAr: 'مراقب الجودة', labelEn: 'Quality Control', color: 'bg-emerald-600 text-white' },
    { role: 'DATA_ENTRY', labelAr: 'مدخل بيانات', labelEn: 'Data Entry', color: 'bg-sky-600 text-white' },
    { role: 'ACCOUNTING', labelAr: 'محاسبة وتكاليف', labelEn: 'Accounting', color: 'bg-purple-600 text-white' },
    { role: 'REPORT_VIEWER', labelAr: 'مشاهد تقارير', labelEn: 'Report Viewer', color: 'bg-slate-700 text-white' },
    { role: 'MAINTENANCE', labelAr: 'مسؤول صيانة', labelEn: 'Maintenance', color: 'bg-orange-600 text-white' },
  ];

  return (
    <div className="space-y-4 text-start" dir={isRtl ? 'rtl' : 'ltr'}>
      {/* Preset Quick Select Bar */}
      <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-amber-400" />
            <span>{language === 'ar' ? 'تطبيق قالب صلاحيات سريع (Presets):' : 'Apply Role Preset Template:'}</span>
          </label>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => handleSelectAll(true)}
              disabled={disabled}
              className="text-[11px] text-indigo-400 hover:text-indigo-300 font-bold cursor-pointer disabled:opacity-40"
            >
              {language === 'ar' ? 'تحديد الكل' : 'Select All'}
            </button>
            <span className="text-slate-600">|</span>
            <button
              type="button"
              onClick={() => handleSelectAll(false)}
              disabled={disabled}
              className="text-[11px] text-slate-400 hover:text-slate-300 font-bold cursor-pointer disabled:opacity-40"
            >
              {language === 'ar' ? 'إلغاء الكل' : 'Deselect All'}
            </button>
          </div>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {presets.map((p) => {
            const isSelected = selectedRolePreset === p.role;
            return (
              <button
                key={p.role}
                type="button"
                onClick={() => handleApplyPreset(p.role)}
                disabled={disabled}
                className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer disabled:opacity-40 flex items-center gap-1 ${
                  isSelected
                    ? `${p.color} ring-2 ring-amber-400 ring-offset-1 ring-offset-slate-900 shadow-xs`
                    : 'bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white border border-slate-700'
                }`}
              >
                {isSelected && <Check className="w-3 h-3" />}
                <span>{language === 'ar' ? p.labelAr : p.labelEn}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Categorized Permissions Grid */}
      <div className="space-y-3 max-h-[380px] overflow-y-auto pr-1">
        {PERMISSION_CATEGORIES.map((cat) => {
          const CategoryIcon = getCategoryIcon(cat.id);
          const activeCount = cat.permissions.filter((p) => permissions[p.key]).length;
          const totalCount = cat.permissions.length;

          return (
            <div
              key={cat.id}
              className="p-3 rounded-xl bg-slate-900 border border-slate-800 hover:border-slate-700 transition"
            >
              <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-800/80">
                <div className="flex items-center gap-2">
                  <div className="p-1 rounded-md bg-slate-800 text-amber-400">
                    <CategoryIcon className="w-3.5 h-3.5" />
                  </div>
                  <div>
                    <h5 className="text-xs font-bold text-white">
                      {language === 'ar' ? cat.nameAr : cat.nameEn}
                    </h5>
                  </div>
                </div>

                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-slate-700">
                  {activeCount}/{totalCount}
                </span>
              </div>

              {/* Permission items */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {cat.permissions.map((perm) => {
                  const isChecked = Boolean(permissions[perm.key]);
                  return (
                    <label
                      key={perm.key}
                      className={`flex items-start gap-2.5 p-2 rounded-lg border transition cursor-pointer select-none ${
                        isChecked
                          ? 'bg-indigo-950/30 border-indigo-500/40 text-slate-100'
                          : 'bg-slate-950/60 border-slate-800 text-slate-400 hover:border-slate-700'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={isChecked}
                        disabled={disabled}
                        onChange={() => handleToggle(perm.key)}
                        className="mt-0.5 w-4 h-4 rounded text-indigo-600 bg-slate-900 border-slate-700 focus:ring-indigo-500 focus:ring-offset-slate-900 cursor-pointer shrink-0"
                      />
                      <div className="min-w-0">
                        <span className={`text-xs font-bold block leading-tight ${isChecked ? 'text-white' : 'text-slate-300'}`}>
                          {language === 'ar' ? perm.nameAr : perm.nameEn}
                        </span>
                        <span className="text-[10px] text-slate-500 block leading-tight mt-0.5">
                          {language === 'ar' ? perm.descriptionAr : perm.descriptionEn}
                        </span>
                      </div>
                    </label>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

/**
 * ASFOUR ERP - Advanced Granular Permission Editor & Preset Selector
 * 
 * Provides fine-grained access control across 28+ grouped permissions:
 * - Data Visibility Scope (ALL, OWN_RECORDS, OWN_SHIFT, SELECTED_STAGES)
 * - 8 Production Stages Access matrix
 * - Master Data & Inline Add (+) permission
 * - Actions (Create, Edit, Delete, Submit, Review, Approve, Reject, Correct, Import, Export, Undo)
 * - Field-level restrictions (Costs, Downtime, Consumption, Tonnage)
 * - Search filter & Category Bulk Select/Deselect
 * - Audit Trail Reason tracking
 */
import React, { useState } from 'react';
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
  CheckCircle2,
  Search,
  ChevronDown,
  ChevronUp,
  Eye,
  SlidersHorizontal,
  CheckSquare,
  Square,
  Building2,
  FileSpreadsheet,
  UploadCloud,
  EyeOff
} from 'lucide-react';
import { 
  GranularPermissions, 
  PermissionCategoryGroup, 
  PermissionKey,
  DataScopeType 
} from '../../types/permissions';
import { UserRole, ProductionStageType } from '../../types';
import { 
  PERMISSION_CATEGORIES, 
  ROLE_PRESET_MAP, 
  ALL_PERMISSION_KEYS,
  countActivePermissions
} from '../../utils/permissions';
import { useLanguage } from '../../i18n/LanguageContext';
import { STAGE_DISPLAY_NAMES } from '../../services/stageRecordService';

interface GranularPermissionEditorProps {
  permissions: GranularPermissions;
  onChange: (updatedPermissions: GranularPermissions) => void;
  selectedRolePreset?: UserRole;
  onRolePresetSelect?: (role: UserRole) => void;
  disabled?: boolean;
  reason?: string;
  onReasonChange?: (reason: string) => void;
}

export const GranularPermissionEditor: React.FC<GranularPermissionEditorProps> = ({
  permissions,
  onChange,
  selectedRolePreset,
  onRolePresetSelect,
  disabled = false,
  reason = '',
  onReasonChange,
}) => {
  const { language, isRtl } = useLanguage();
  const [searchQuery, setSearchQuery] = useState('');
  const [collapsedCategories, setCollapsedCategories] = useState<Record<string, boolean>>({});

  const handleToggle = (key: PermissionKey) => {
    if (disabled) return;
    onChange({
      ...permissions,
      [key]: !permissions[key],
    });
  };

  const handleDataScopeChange = (scope: DataScopeType) => {
    if (disabled) return;
    onChange({
      ...permissions,
      dataScope: scope,
      'production.scope': scope === 'ALL' ? 'all' : (scope === 'OWN_SHIFT' ? 'shift' : 'own'),
    });
  };

  const handleStageToggle = (stageKey: ProductionStageType) => {
    if (disabled) return;
    const stagePermKey = `stage.${stageKey}` as PermissionKey;
    const currentVal = Boolean(permissions[stagePermKey]);
    
    // Also manage allowedStages array
    const currentAllowed = permissions.allowedStages || [];
    let updatedAllowed = [...currentAllowed];
    if (currentVal) {
      updatedAllowed = updatedAllowed.filter(s => s !== stageKey);
    } else {
      if (!updatedAllowed.includes(stageKey)) updatedAllowed.push(stageKey);
    }

    onChange({
      ...permissions,
      [stagePermKey]: !currentVal,
      allowedStages: updatedAllowed,
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
    const updated: any = { ...permissions };
    ALL_PERMISSION_KEYS.forEach((k) => {
      updated[k] = select;
    });
    if (select) {
      updated.dataScope = 'ALL';
      updated['production.scope'] = 'all';
      updated.allowedStages = ['pressing', 'rotary_furnace', 'chinese_mills', 'tube_ball_mills', 'mortar_concrete', 'mixing', 'lightweight_foam', 'sorting'];
    } else {
      updated.dataScope = 'OWN_RECORDS';
      updated['production.scope'] = 'own';
      updated.allowedStages = [];
    }
    onChange(updated);
  };

  const handleCategorySelectAll = (category: PermissionCategoryGroup, select: boolean) => {
    if (disabled) return;
    const updated: any = { ...permissions };
    category.permissions.forEach((p) => {
      updated[p.key] = select;
    });
    onChange(updated);
  };

  const toggleCategoryCollapse = (catId: string) => {
    setCollapsedCategories(prev => ({
      ...prev,
      [catId]: !prev[catId],
    }));
  };

  // Get icon for category
  const getCategoryIcon = (id: string) => {
    switch (id) {
      case 'dashboard': return BarChart3;
      case 'production_entry': return Layers;
      case 'production_records': return FileText;
      case 'approval': return CheckCircle2;
      case 'stages': return Flame;
      case 'masterdata': return Database;
      case 'historical_import': return UploadCloud;
      case 'reports_excel': return FileSpreadsheet;
      case 'ai': return Sparkles;
      case 'users': return Users;
      case 'backup_restore': return HardDrive;
      case 'system_admin': return ShieldCheck;
      case 'field_restrictions': return EyeOff;
      default: return ShieldCheck;
    }
  };

  const presets: { role: UserRole; labelAr: string; labelEn: string; color: string }[] = [
    { role: 'SUPER_ADMIN', labelAr: 'المشرف العام (كامل الصلاحيات)', labelEn: 'Super Admin', color: 'bg-indigo-600 text-white' },
    { role: 'PRODUCTION_SUPERVISOR', labelAr: 'مشرف إنتاج (اعتماد ومراجعة)', labelEn: 'Supervisor', color: 'bg-amber-600 text-white' },
    { role: 'PRODUCTION_OPERATOR', labelAr: 'مشغل خط إنتاج (إدخال وردية)', labelEn: 'Operator', color: 'bg-amber-500 text-slate-950 font-bold' },
    { role: 'QUALITY_CONTROL', labelAr: 'مراقب جودة وتدقيق', labelEn: 'Quality Control', color: 'bg-emerald-600 text-white' },
    { role: 'DATA_ENTRY', labelAr: 'مدخل بيانات واستيراد', labelEn: 'Data Entry', color: 'bg-sky-600 text-white' },
    { role: 'ACCOUNTING', labelAr: 'محاسبة وتكاليف', labelEn: 'Accounting', color: 'bg-purple-600 text-white' },
    { role: 'REPORT_VIEWER', labelAr: 'مشاهد تقارير فقط', labelEn: 'Report Viewer', color: 'bg-slate-700 text-white' },
    { role: 'MAINTENANCE', labelAr: 'مسؤول صيانة وأعطال', labelEn: 'Maintenance', color: 'bg-orange-600 text-white' },
  ];

  const dataScopeOptions: { scope: DataScopeType; labelAr: string; labelEn: string; descAr: string; descEn: string }[] = [
    { scope: 'ALL', labelAr: 'كافة بيانات المصنع (بدون قيود)', labelEn: 'All Factory Data', descAr: 'رؤية كامل السجلات لجميع الورديات والأقسام', descEn: 'Full access to all shifts and departments' },
    { scope: 'OWN_SHIFT', labelAr: 'سجلات الوردية الخاصة بالمستخدم', labelEn: 'Own Shift Only', descAr: 'حصر الرؤية على نفس الوردية التشغيلية', descEn: 'Restricted to records matching user shift' },
    { scope: 'OWN_RECORDS', labelAr: 'السجلات التي أنشأها المستخدم فقط', labelEn: 'Own Records Only', descAr: 'رؤية السجلات المسجلة بواسطة المستخدم فقط', descEn: 'Restricted strictly to self-created entries' },
    { scope: 'SELECTED_STAGES', labelAr: 'حسب المراحل الإنتاجية المحددة أدناه', labelEn: 'Selected Stages Only', descAr: 'تقييد الوصول لمراحل محددة فقط من الـ 8 مراحل', descEn: 'Access limited to checked stages in matrix' },
  ];

  // Filter categories and permissions based on search query
  const filteredCategories = PERMISSION_CATEGORIES.map(cat => {
    if (!searchQuery.trim()) return cat;
    const q = searchQuery.toLowerCase();
    const matchesCat = cat.nameAr.toLowerCase().includes(q) || cat.nameEn.toLowerCase().includes(q);
    const matchedPerms = cat.permissions.filter(p => 
      matchesCat ||
      p.nameAr.toLowerCase().includes(q) ||
      p.nameEn.toLowerCase().includes(q) ||
      p.descriptionAr.toLowerCase().includes(q) ||
      p.descriptionEn.toLowerCase().includes(q) ||
      p.key.toLowerCase().includes(q)
    );
    return {
      ...cat,
      permissions: matchedPerms,
    };
  }).filter(cat => cat.permissions.length > 0);

  const activePermissionsCount = countActivePermissions(permissions);

  return (
    <div className="space-y-4 text-start" dir={isRtl ? 'rtl' : 'ltr'}>
      {/* Top Bar: Active Summary & Presets */}
      <div className="p-4 bg-slate-900 rounded-2xl border border-slate-800 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-indigo-500/20 text-indigo-400 flex items-center justify-center border border-indigo-500/30">
              <ShieldCheck className="w-4 h-4" />
            </div>
            <div>
              <h4 className="text-xs font-bold text-white flex items-center gap-2">
                <span>{language === 'ar' ? 'مصفوفة الصلاحيات المتقدمة' : 'Advanced Permission Matrix'}</span>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                  {activePermissionsCount} {language === 'ar' ? 'صلاحية مفعلة' : 'Active'}
                </span>
              </h4>
              <span className="text-[11px] text-slate-400">
                {language === 'ar' ? 'تحكم دقيق بمستوى الشاشات والإجراءات والمراحل ونطاق البيانات' : 'Granular control across screens, actions, stages & data scopes'}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => handleSelectAll(true)}
              disabled={disabled}
              className="px-2.5 py-1 rounded-lg text-xs font-bold bg-indigo-600 hover:bg-indigo-500 text-white cursor-pointer transition disabled:opacity-40"
            >
              {language === 'ar' ? 'تفعيل الكل' : 'Enable All'}
            </button>
            <button
              type="button"
              onClick={() => handleSelectAll(false)}
              disabled={disabled}
              className="px-2.5 py-1 rounded-lg text-xs font-bold bg-slate-800 hover:bg-slate-700 text-slate-300 cursor-pointer transition border border-slate-700 disabled:opacity-40"
            >
              {language === 'ar' ? 'تعطيل الكل' : 'Disable All'}
            </button>
          </div>
        </div>

        {/* Preset Role Quick-Selector */}
        <div className="pt-2 border-t border-slate-800">
          <label className="text-[11px] font-bold text-slate-400 flex items-center gap-1.5 mb-2">
            <Sparkles className="w-3.5 h-3.5 text-amber-400" />
            <span>{language === 'ar' ? 'تطبيق قالب جاهز حسب الدور الوظيفي (Presets):' : 'Apply Ready Role Preset Template:'}</span>
          </label>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
            {presets.map((p) => {
              const isSelected = selectedRolePreset === p.role;
              return (
                <button
                  key={p.role}
                  type="button"
                  onClick={() => handleApplyPreset(p.role)}
                  disabled={disabled}
                  className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer disabled:opacity-40 flex items-center justify-between text-start ${
                    isSelected
                      ? `${p.color} ring-2 ring-amber-400 ring-offset-1 ring-offset-slate-900 shadow-xs`
                      : 'bg-slate-800/80 text-slate-300 hover:bg-slate-800 hover:text-white border border-slate-700'
                  }`}
                >
                  <span className="truncate">{language === 'ar' ? p.labelAr : p.labelEn}</span>
                  {isSelected && <Check className="w-3.5 h-3.5 shrink-0 ml-1" />}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Data Visibility Scope Selector */}
      <div className="p-3.5 bg-slate-900 rounded-2xl border border-slate-800 space-y-2">
        <label className="text-xs font-bold text-white flex items-center gap-2">
          <Eye className="w-4 h-4 text-emerald-400" />
          <span>{language === 'ar' ? 'نطاق رؤية البيانات (Data Scope Restriction):' : 'Data Visibility Scope:'}</span>
        </label>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {dataScopeOptions.map((opt) => {
            const isCurrent = (permissions.dataScope || 'ALL') === opt.scope;
            return (
              <div
                key={opt.scope}
                onClick={() => handleDataScopeChange(opt.scope)}
                className={`p-2.5 rounded-xl border transition cursor-pointer ${
                  isCurrent
                    ? 'bg-emerald-950/40 border-emerald-500/50 text-white shadow-xs'
                    : 'bg-slate-950/60 border-slate-800 text-slate-400 hover:border-slate-700'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className={`text-xs font-bold ${isCurrent ? 'text-emerald-300' : 'text-slate-200'}`}>
                    {language === 'ar' ? opt.labelAr : opt.labelEn}
                  </span>
                  <div className={`w-4 h-4 rounded-full border flex items-center justify-center ${
                    isCurrent ? 'border-emerald-400 bg-emerald-500 text-slate-950' : 'border-slate-700'
                  }`}>
                    {isCurrent && <Check className="w-2.5 h-2.5 stroke-[3]" />}
                  </div>
                </div>
                <p className="text-[10px] text-slate-400 mt-1 leading-tight">
                  {language === 'ar' ? opt.descAr : opt.descEn}
                </p>
              </div>
            );
          })}
        </div>
      </div>

      {/* 8 Production Stages Access Matrix */}
      <div className="p-3.5 bg-slate-900 rounded-2xl border border-slate-800 space-y-2.5">
        <div className="flex items-center justify-between">
          <label className="text-xs font-bold text-white flex items-center gap-2">
            <Flame className="w-4 h-4 text-amber-400" />
            <span>{language === 'ar' ? 'صلاحيات الوصول لمراحل الإنتاج (8 مراحل):' : '8 Production Stages Access Matrix:'}</span>
          </label>
          <span className="text-[10px] text-amber-400 font-mono">
            {Object.keys(STAGE_DISPLAY_NAMES).filter(s => Boolean(permissions[`stage.${s}` as PermissionKey])).length} / 8 {language === 'ar' ? 'مراحل مسموحة' : 'Allowed'}
          </span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {(Object.keys(STAGE_DISPLAY_NAMES) as ProductionStageType[]).map((stageKey, idx) => {
            const isAllowed = Boolean(permissions[`stage.${stageKey}` as PermissionKey]);
            return (
              <button
                key={stageKey}
                type="button"
                onClick={() => handleStageToggle(stageKey)}
                disabled={disabled}
                className={`p-2.5 rounded-xl border text-start transition cursor-pointer disabled:opacity-40 flex items-center justify-between ${
                  isAllowed
                    ? 'bg-amber-950/30 border-amber-500/40 text-amber-200'
                    : 'bg-slate-950/60 border-slate-800 text-slate-500 hover:border-slate-700'
                }`}
              >
                <div className="min-w-0">
                  <span className="text-[10px] text-slate-500 font-mono block">مرحلة {idx + 1}</span>
                  <span className="text-xs font-bold truncate block">{STAGE_DISPLAY_NAMES[stageKey]}</span>
                </div>
                <div className={`w-4 h-4 rounded border shrink-0 flex items-center justify-center ${
                  isAllowed ? 'border-amber-400 bg-amber-500 text-slate-950' : 'border-slate-700'
                }`}>
                  {isAllowed && <Check className="w-3 h-3 stroke-[3]" />}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Search Toolbar */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-400 absolute top-2.5 start-3" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={language === 'ar' ? 'ابحث في الصلاحيات أو الشاشات...' : 'Search permissions or screens...'}
            className="w-full ps-9 pe-3 py-1.5 bg-slate-900 border border-slate-800 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-amber-400"
          />
        </div>
      </div>

      {/* Categorized Permissions Accordion */}
      <div className="space-y-2.5 max-h-[420px] overflow-y-auto pr-1">
        {filteredCategories.map((cat) => {
          const CategoryIcon = getCategoryIcon(cat.id);
          const activeCount = cat.permissions.filter((p) => permissions[p.key]).length;
          const totalCount = cat.permissions.length;
          const isCollapsed = Boolean(collapsedCategories[cat.id]);

          return (
            <div
              key={cat.id}
              className="p-3 rounded-2xl bg-slate-900 border border-slate-800 hover:border-slate-700 transition"
            >
              {/* Category Header */}
              <div className="flex items-center justify-between pb-2 border-b border-slate-800">
                <button
                  type="button"
                  onClick={() => toggleCategoryCollapse(cat.id)}
                  className="flex items-center gap-2 text-start cursor-pointer group"
                >
                  <div className="p-1 rounded-lg bg-slate-800 text-amber-400 group-hover:bg-slate-700 transition">
                    <CategoryIcon className="w-4 h-4" />
                  </div>
                  <div>
                    <h5 className="text-xs font-bold text-white group-hover:text-amber-300 transition flex items-center gap-1.5">
                      <span>{language === 'ar' ? cat.nameAr : cat.nameEn}</span>
                      {isCollapsed ? <ChevronDown className="w-3.5 h-3.5 text-slate-500" /> : <ChevronUp className="w-3.5 h-3.5 text-slate-500" />}
                    </h5>
                  </div>
                </button>

                <div className="flex items-center gap-2">
                  <span className={`text-[10px] font-mono px-2 py-0.5 rounded-full border ${
                    activeCount > 0 
                      ? 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30 font-bold' 
                      : 'bg-slate-800 text-slate-400 border-slate-700'
                  }`}>
                    {activeCount}/{totalCount}
                  </span>

                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => handleCategorySelectAll(cat, true)}
                      disabled={disabled}
                      title={language === 'ar' ? 'تحديد كل عناصر المجموعة' : 'Select all in group'}
                      className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-white cursor-pointer disabled:opacity-40"
                    >
                      <CheckSquare className="w-3.5 h-3.5 text-indigo-400" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleCategorySelectAll(cat, false)}
                      disabled={disabled}
                      title={language === 'ar' ? 'إلغاء كل عناصر المجموعة' : 'Deselect all in group'}
                      className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-white cursor-pointer disabled:opacity-40"
                    >
                      <Square className="w-3.5 h-3.5 text-slate-500" />
                    </button>
                  </div>
                </div>
              </div>

              {/* Permission items */}
              {!isCollapsed && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2.5">
                  {cat.permissions.map((perm) => {
                    const isChecked = Boolean(permissions[perm.key]);
                    return (
                      <label
                        key={perm.key}
                        className={`flex items-start gap-2.5 p-2.5 rounded-xl border transition cursor-pointer select-none ${
                          isChecked
                            ? 'bg-indigo-950/40 border-indigo-500/40 text-slate-100 shadow-xs'
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
                          <span className="text-[10px] text-slate-500 block leading-tight mt-1">
                            {language === 'ar' ? perm.descriptionAr : perm.descriptionEn}
                          </span>
                          <span className="text-[9px] font-mono text-slate-600 block mt-0.5">
                            {perm.key}
                          </span>
                        </div>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Audit Reason Note Field */}
      {onReasonChange && (
        <div className="p-3 bg-slate-900 rounded-2xl border border-slate-800 space-y-1.5">
          <label className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
            <FileText className="w-3.5 h-3.5 text-amber-400" />
            <span>{language === 'ar' ? 'سبب تعديل الصلاحيات (سجل التدقيق الأمني):' : 'Audit Trail Change Reason:'}</span>
          </label>
          <input
            type="text"
            value={reason}
            onChange={(e) => onReasonChange(e.target.value)}
            disabled={disabled}
            placeholder={language === 'ar' ? 'اكتب سبب التعديل (مثال: ترقية للمشرف / تكليف بمهام الجودة)...' : 'Enter reason for permission modification...'}
            className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-amber-400"
          />
        </div>
      )}
    </div>
  );
};

/**
 * ASFOUR ERP - Permission Presets & Access Control Evaluator
 * Defines fine-grained, category-grouped access rights, role presets, and security evaluators.
 */
import { 
  GranularPermissions, 
  PermissionKey, 
  UserRole, 
  PermissionCategoryGroup,
  DataScopeType 
} from '../types/permissions';
import { AdminUser, NavigationPage, ProductionStageType } from '../types';

export const CURRENT_PERMISSION_SCHEMA_VERSION = 2;

export const DEFAULT_SUPER_ADMIN_PERMISSIONS: GranularPermissions = {
  permissionSchemaVersion: CURRENT_PERMISSION_SCHEMA_VERSION,
  dataScope: 'ALL',
  'production.scope': 'all',
  allowedStages: ['pressing', 'rotary_furnace', 'chinese_mills', 'tube_ball_mills', 'mortar_concrete', 'mixing', 'lightweight_foam', 'sorting'],
  allowedDepartments: [],
  allowedUsers: [],

  // 1. Dashboard
  'dashboard.view': true,
  'dashboard.export_kpi': true,

  // 2. Production Entry & Operations
  'production.view': true,
  'production.create': true,
  'production.edit': true,
  'production.delete': true,
  'production.submit': true,
  'production.review': true,
  'production.approve': true,
  'production.reject': true,
  'production.correct': true,

  // 3. Approvals
  'approval.view': true,
  'approval.approve': true,
  'approval.reject': true,
  'approval.batch_approve': true,

  // 4. 8 Stages
  'stage.pressing': true,
  'stage.rotary_furnace': true,
  'stage.chinese_mills': true,
  'stage.tube_ball_mills': true,
  'stage.mortar_concrete': true,
  'stage.mixing': true,
  'stage.lightweight_foam': true,
  'stage.sorting': true,

  // 5. Master Data & Inline Add
  'masterdata.view': true,
  'masterData.inlineAdd': true,
  'employees.view': true,
  'employees.create': true,
  'employees.edit': true,
  'employees.delete': true,
  'products.view': true,
  'products.create': true,
  'products.edit': true,
  'products.delete': true,
  'customers.view': true,
  'customers.create': true,
  'customers.edit': true,
  'customers.delete': true,
  'presses.view': true,
  'presses.create': true,
  'presses.edit': true,
  'presses.delete': true,
  'furnaces.view': true,
  'furnaces.create': true,
  'furnaces.edit': true,
  'furnaces.delete': true,
  'furnaceCars.view': true,
  'furnaceCars.create': true,
  'furnaceCars.edit': true,
  'furnaceCars.delete': true,
  'shifts.view': true,
  'shifts.create': true,
  'shifts.edit': true,
  'shifts.delete': true,
  'materials.view': true,
  'materials.create': true,
  'materials.edit': true,
  'materials.delete': true,
  'inventory.view': true,
  'inventory.manage': true,
  'machines.view': true,
  'machines.create': true,
  'machines.edit': true,
  'machines.delete': true,

  // 6. Historical Import & Smart Matching
  'excel.import': true,
  'historical.import.view': true,
  'historical.import.execute': true,
  'historical.import.approve_matching': true,
  'historical.import.undo': true,
  'historical.import.backup_before': true,

  // 7. Excel Export
  'excel.export': true,
  'excel.template_download': true,

  // 8. Reports
  'reports.view': true,
  'reports.export': true,
  'reports.custom_queries': true,

  // 9. AI Assistant
  'ai.use': true,
  'ai.advanced_analysis': true,

  // 10. User Management & Permissions
  'users.view': true,
  'users.create': true,
  'users.edit': true,
  'users.activate': true,
  'users.deactivate': true,
  'users.reset_password': true,
  'users.change_role': true,
  'users.manage_permissions': true,
  'permissions.view': true,
  'permissions.edit': true,

  // 11. Backup & Restore
  'backup.view': true,
  'backup.create': true,
  'backup.download': true,
  'backup.delete': true,
  'restore.view': true,
  'restore.execute': true,

  // 12. System Health, Audit, Settings, Branding, Versions
  'system.view': true,
  'system.health.view': true,
  'system.manage': true,
  'audit.view': true,
  'settings.view': true,
  'settings.edit': true,
  'branding.view': true,
  'branding.edit': true,
  'versions.view': true,

  // 13. Field Level Permissions
  'fields.view_cost': true,
  'fields.edit_downtime': true,
  'fields.view_consumption': true,
  'fields.view_tonnage': true,
};

export const DEFAULT_PRODUCTION_OPERATOR_PERMISSIONS: GranularPermissions = {
  permissionSchemaVersion: CURRENT_PERMISSION_SCHEMA_VERSION,
  dataScope: 'OWN_RECORDS',
  'production.scope': 'own',
  allowedStages: ['pressing'],
  allowedDepartments: [],
  allowedUsers: [],

  'dashboard.view': false,
  'dashboard.export_kpi': false,
  'production.view': true,
  'production.create': true,
  'production.edit': true,
  'production.delete': false,
  'production.submit': true,
  'production.review': false,
  'production.approve': false,
  'production.reject': false,
  'production.correct': false,

  'approval.view': false,
  'approval.approve': false,
  'approval.reject': false,
  'approval.batch_approve': false,

  'stage.pressing': true,
  'stage.rotary_furnace': true,
  'stage.chinese_mills': true,
  'stage.tube_ball_mills': true,
  'stage.mortar_concrete': true,
  'stage.mixing': true,
  'stage.lightweight_foam': true,
  'stage.sorting': true,

  'masterdata.view': false,
  'masterData.inlineAdd': false,
  'employees.view': false,
  'employees.create': false,
  'employees.edit': false,
  'employees.delete': false,
  'products.view': false,
  'products.create': false,
  'products.edit': false,
  'products.delete': false,
  'customers.view': false,
  'customers.create': false,
  'customers.edit': false,
  'customers.delete': false,
  'presses.view': false,
  'presses.create': false,
  'presses.edit': false,
  'presses.delete': false,
  'furnaces.view': false,
  'furnaces.create': false,
  'furnaces.edit': false,
  'furnaces.delete': false,
  'furnaceCars.view': false,
  'furnaceCars.create': false,
  'furnaceCars.edit': false,
  'furnaceCars.delete': false,
  'shifts.view': false,
  'shifts.create': false,
  'shifts.edit': false,
  'shifts.delete': false,
  'materials.view': false,
  'materials.create': false,
  'materials.edit': false,
  'materials.delete': false,
  'inventory.view': false,
  'inventory.manage': false,
  'machines.view': false,
  'machines.create': false,
  'machines.edit': false,
  'machines.delete': false,

  'excel.import': false,
  'historical.import.view': false,
  'historical.import.execute': false,
  'historical.import.approve_matching': false,
  'historical.import.undo': false,
  'historical.import.backup_before': false,

  'excel.export': false,
  'excel.template_download': false,
  'reports.view': false,
  'reports.export': false,
  'reports.custom_queries': false,
  'ai.use': false,
  'ai.advanced_analysis': false,

  'users.view': false,
  'users.create': false,
  'users.edit': false,
  'users.activate': false,
  'users.deactivate': false,
  'users.reset_password': false,
  'users.change_role': false,
  'users.manage_permissions': false,
  'permissions.view': false,
  'permissions.edit': false,

  'backup.view': false,
  'backup.create': false,
  'backup.download': false,
  'backup.delete': false,
  'restore.view': false,
  'restore.execute': false,

  'system.view': false,
  'system.health.view': false,
  'system.manage': false,
  'audit.view': false,
  'settings.view': false,
  'settings.edit': false,
  'branding.view': false,
  'branding.edit': false,
  'versions.view': false,

  'fields.view_cost': false,
  'fields.edit_downtime': true,
  'fields.view_consumption': false,
  'fields.view_tonnage': true,
};

export const DEFAULT_PRODUCTION_SUPERVISOR_PERMISSIONS: GranularPermissions = {
  ...DEFAULT_PRODUCTION_OPERATOR_PERMISSIONS,
  dataScope: 'OWN_SHIFT',
  'production.scope': 'shift',
  'dashboard.view': true,
  'dashboard.export_kpi': true,
  'production.view': true,
  'production.create': true,
  'production.edit': true,
  'production.delete': false,
  'production.submit': true,
  'production.review': true,
  'production.approve': true,
  'production.reject': true,
  'production.correct': true,

  'approval.view': true,
  'approval.approve': true,
  'approval.reject': true,
  'approval.batch_approve': false,

  'masterdata.view': true,
  'masterData.inlineAdd': true,
  'employees.view': true,
  'products.view': true,
  'customers.view': true,
  'presses.view': true,
  'furnaces.view': true,
  'furnaceCars.view': true,
  'shifts.view': true,
  'materials.view': true,
  'machines.view': true,
  'reports.view': true,
  'reports.export': true,
  'excel.export': true,
  'excel.template_download': true,
  'ai.use': true,

  'fields.view_cost': false,
  'fields.edit_downtime': true,
  'fields.view_consumption': true,
  'fields.view_tonnage': true,
};

export const DEFAULT_QUALITY_CONTROL_PERMISSIONS: GranularPermissions = {
  ...DEFAULT_PRODUCTION_OPERATOR_PERMISSIONS,
  dataScope: 'ALL',
  'production.scope': 'all',
  'dashboard.view': true,
  'production.view': true,
  'production.create': false,
  'production.edit': false,
  'production.delete': false,
  'production.submit': false,
  'production.review': true,
  'production.approve': true,
  'production.reject': true,
  'production.correct': true,
  'approval.view': true,
  'approval.approve': true,
  'approval.reject': true,
  'masterdata.view': true,
  'products.view': true,
  'reports.view': true,
  'reports.export': true,
  'excel.export': true,
  'ai.use': true,
};

export const DEFAULT_DATA_ENTRY_PERMISSIONS: GranularPermissions = {
  ...DEFAULT_PRODUCTION_OPERATOR_PERMISSIONS,
  dataScope: 'ALL',
  'production.scope': 'all',
  'dashboard.view': true,
  'production.view': true,
  'production.create': true,
  'production.edit': true,
  'production.delete': false,
  'production.submit': true,
  'production.review': false,
  'production.approve': false,
  'masterdata.view': true,
  'masterData.inlineAdd': true,
  'employees.view': true,
  'employees.create': true,
  'employees.edit': true,
  'products.view': true,
  'products.create': true,
  'products.edit': true,
  'customers.view': true,
  'customers.create': true,
  'customers.edit': true,
  'presses.view': true,
  'furnaces.view': true,
  'furnaceCars.view': true,
  'shifts.view': true,
  'materials.view': true,
  'excel.import': true,
  'historical.import.view': true,
  'historical.import.execute': true,
  'excel.export': true,
  'excel.template_download': true,
};

export const DEFAULT_ACCOUNTING_PERMISSIONS: GranularPermissions = {
  ...DEFAULT_PRODUCTION_OPERATOR_PERMISSIONS,
  dataScope: 'ALL',
  'production.scope': 'all',
  'dashboard.view': true,
  'dashboard.export_kpi': true,
  'production.view': true,
  'production.create': false,
  'production.edit': false,
  'masterdata.view': true,
  'materials.view': true,
  'inventory.view': true,
  'reports.view': true,
  'reports.export': true,
  'reports.custom_queries': true,
  'excel.export': true,
  'fields.view_cost': true,
  'fields.view_consumption': true,
  'fields.view_tonnage': true,
};

export const DEFAULT_REPORT_VIEWER_PERMISSIONS: GranularPermissions = {
  ...DEFAULT_PRODUCTION_OPERATOR_PERMISSIONS,
  dataScope: 'ALL',
  'production.scope': 'all',
  'dashboard.view': true,
  'dashboard.export_kpi': true,
  'production.view': true,
  'production.create': false,
  'production.edit': false,
  'masterdata.view': true,
  'reports.view': true,
  'reports.export': true,
  'excel.export': true,
};

export const DEFAULT_MAINTENANCE_PERMISSIONS: GranularPermissions = {
  ...DEFAULT_PRODUCTION_OPERATOR_PERMISSIONS,
  dataScope: 'ALL',
  'production.scope': 'all',
  'dashboard.view': true,
  'production.view': true,
  'presses.view': true,
  'presses.edit': true,
  'furnaces.view': true,
  'furnaces.edit': true,
  'machines.view': true,
  'machines.edit': true,
  'reports.view': true,
  'system.view': true,
  'fields.edit_downtime': true,
};

export const ROLE_PRESET_MAP: Record<UserRole, GranularPermissions> = {
  SUPER_ADMIN: DEFAULT_SUPER_ADMIN_PERMISSIONS,
  ADMIN: DEFAULT_SUPER_ADMIN_PERMISSIONS,
  SUPERVISOR: DEFAULT_PRODUCTION_SUPERVISOR_PERMISSIONS,
  PRODUCTION_SUPERVISOR: DEFAULT_PRODUCTION_SUPERVISOR_PERMISSIONS,
  PRODUCTION_OPERATOR: DEFAULT_PRODUCTION_OPERATOR_PERMISSIONS,
  PRODUCTION_USER: DEFAULT_PRODUCTION_OPERATOR_PERMISSIONS,
  QUALITY_CONTROL: DEFAULT_QUALITY_CONTROL_PERMISSIONS,
  DATA_ENTRY: DEFAULT_DATA_ENTRY_PERMISSIONS,
  ACCOUNTING: DEFAULT_ACCOUNTING_PERMISSIONS,
  REPORT_VIEWER: DEFAULT_REPORT_VIEWER_PERMISSIONS,
  MAINTENANCE: DEFAULT_MAINTENANCE_PERMISSIONS,
  VIEWER: DEFAULT_REPORT_VIEWER_PERMISSIONS,
  CUSTOM: DEFAULT_PRODUCTION_OPERATOR_PERMISSIONS,
};

export function getRolePresetPermissions(role: UserRole): GranularPermissions {
  return { ...(ROLE_PRESET_MAP[role] || DEFAULT_PRODUCTION_OPERATOR_PERMISSIONS) };
}

/**
 * Normalizes raw or legacy permissions into a valid GranularPermissions object.
 * Guarantees no undefined properties and maps legacy permission keys transparently.
 */
export function normalizePermissions(
  rawPermissions: any, 
  role: UserRole = 'PRODUCTION_OPERATOR'
): GranularPermissions {
  const base = getRolePresetPermissions(role);
  if (!rawPermissions || typeof rawPermissions !== 'object') {
    return { ...base };
  }

  const normalized: any = { ...base };

  // Data scope
  if (rawPermissions.dataScope) {
    normalized.dataScope = rawPermissions.dataScope;
  }
  if (rawPermissions['production.scope']) {
    normalized['production.scope'] = rawPermissions['production.scope'];
  }
  if (Array.isArray(rawPermissions.allowedStages)) {
    normalized.allowedStages = rawPermissions.allowedStages.filter(Boolean);
  }
  if (Array.isArray(rawPermissions.allowedDepartments)) {
    normalized.allowedDepartments = rawPermissions.allowedDepartments.filter(Boolean);
  }
  if (Array.isArray(rawPermissions.allowedUsers)) {
    normalized.allowedUsers = rawPermissions.allowedUsers.filter(Boolean);
  }

  // Boolean flags normalization
  Object.keys(DEFAULT_SUPER_ADMIN_PERMISSIONS).forEach((k) => {
    if (k in rawPermissions && typeof rawPermissions[k] === 'boolean') {
      normalized[k] = rawPermissions[k];
    }
  });

  // Backward compatibility alias checks
  if (rawPermissions['masterData.inlineAdd'] === undefined) {
    if (rawPermissions['masterdata.view'] && (role === 'SUPER_ADMIN' || role === 'ADMIN' || role === 'PRODUCTION_SUPERVISOR' || role === 'DATA_ENTRY')) {
      normalized['masterData.inlineAdd'] = true;
    }
  }

  if (rawPermissions['approval.view'] === undefined) {
    normalized['approval.view'] = Boolean(rawPermissions['production.approve'] || rawPermissions['production.review']);
  }
  if (rawPermissions['approval.approve'] === undefined) {
    normalized['approval.approve'] = Boolean(rawPermissions['production.approve']);
  }
  if (rawPermissions['approval.reject'] === undefined) {
    normalized['approval.reject'] = Boolean(rawPermissions['production.reject']);
  }

  if (rawPermissions['historical.import.view'] === undefined) {
    normalized['historical.import.view'] = Boolean(rawPermissions['excel.import']);
  }
  if (rawPermissions['historical.import.execute'] === undefined) {
    normalized['historical.import.execute'] = Boolean(rawPermissions['excel.import']);
  }

  normalized.permissionSchemaVersion = CURRENT_PERMISSION_SCHEMA_VERSION;
  return normalized as GranularPermissions;
}

/**
 * Sanitizes permissions before saving to Firestore (strictly removes undefined values).
 */
export function sanitizePermissionsForFirestore(permissions: GranularPermissions): Record<string, any> {
  const result: Record<string, any> = {};
  
  Object.entries(permissions).forEach(([key, val]) => {
    if (val !== undefined && val !== null) {
      if (Array.isArray(val)) {
        result[key] = val.filter(item => typeof item === 'string' && item.trim().length > 0);
      } else if (typeof val === 'boolean' || typeof val === 'string' || typeof val === 'number') {
        result[key] = val;
      }
    }
  });

  result.permissionSchemaVersion = CURRENT_PERMISSION_SCHEMA_VERSION;
  return result;
}

export function resolveUserPermissions(user: AdminUser | null | undefined): GranularPermissions {
  if (!user) {
    return DEFAULT_PRODUCTION_OPERATOR_PERMISSIONS;
  }
  if (user.role === 'SUPER_ADMIN') {
    return DEFAULT_SUPER_ADMIN_PERMISSIONS;
  }
  return normalizePermissions(user.permissions, user.role);
}

export function hasPermission(user: AdminUser | null | undefined, permission: PermissionKey): boolean {
  if (!user) return false;
  if (user.role === 'SUPER_ADMIN') return true;
  const perms = resolveUserPermissions(user);
  return Boolean(perms[permission]);
}

export function canInlineAddMasterData(user: AdminUser | null | undefined): boolean {
  if (!user) return false;
  if (user.role === 'SUPER_ADMIN' || user.role === 'ADMIN') return true;
  const perms = resolveUserPermissions(user);
  return Boolean(perms['masterData.inlineAdd'] || perms['masterdata.view']);
}

export function canAccessStage(user: AdminUser | null | undefined, stageKey: ProductionStageType | string): boolean {
  if (!user) return false;
  if (user.role === 'SUPER_ADMIN') return true;
  const perms = resolveUserPermissions(user);

  // Check stage permission key
  const stagePermissionKey = `stage.${stageKey}` as PermissionKey;
  if (perms[stagePermissionKey] === false) {
    return false;
  }

  // Check allowedStages filter if dataScope is SELECTED_STAGES
  if (perms.dataScope === 'SELECTED_STAGES' && perms.allowedStages && perms.allowedStages.length > 0) {
    return perms.allowedStages.includes(stageKey);
  }

  return true;
}

export function hasFieldPermission(
  user: AdminUser | null | undefined, 
  fieldKey: 'fields.view_cost' | 'fields.edit_downtime' | 'fields.view_consumption' | 'fields.view_tonnage'
): boolean {
  if (!user) return false;
  if (user.role === 'SUPER_ADMIN') return true;
  const perms = resolveUserPermissions(user);
  return Boolean(perms[fieldKey]);
}

export function canAccessPage(user: AdminUser | null | undefined, page: NavigationPage): boolean {
  if (!user) return false;
  if (user.role === 'SUPER_ADMIN') return true;
  const perms = resolveUserPermissions(user);

  switch (page) {
    case 'dashboard':
      return perms['dashboard.view'];
    case 'production':
    case 'production-entry':
      return perms['production.create'] || perms['production.view'];
    case 'production-records':
      return perms['production.view'];
    case 'data-review':
      return perms['production.review'] || perms['production.approve'] || perms['production.correct'] || perms['approval.view'];
    case 'historical-import':
    case 'bulk-entry':
      return perms['excel.import'] || perms['historical.import.view'];
    case 'raw-materials':
    case 'material-traceability':
      return perms['materials.view'] || perms['inventory.view'];
    case 'master-data':
      return perms['masterdata.view'] || perms['employees.view'] || perms['products.view'];
    case 'user-management':
      return perms['users.view'] || perms['permissions.view'];
    case 'reports':
      return perms['reports.view'];
    case 'ai-assistant':
      return perms['ai.use'];
    case 'backups':
    case 'backup-restore':
      return perms['backup.view'];
    case 'restore':
      return perms['restore.view'];
    case 'system-health':
      return perms['system.view'] || perms['system.health.view'];
    case 'versions':
      return perms['versions.view'] || perms['system.view'];
    case 'settings':
    case 'admin-panel':
      return perms['settings.view'] || perms['audit.view'];
    case 'branding':
      return perms['branding.view'] || perms['settings.view'] || user.role === 'ADMIN';
    default:
      return true;
  }
}

export const ALL_PERMISSION_KEYS: PermissionKey[] = Object.keys(DEFAULT_SUPER_ADMIN_PERMISSIONS).filter(
  k => !['permissionSchemaVersion', 'dataScope', 'production.scope', 'allowedStages', 'allowedDepartments', 'allowedUsers'].includes(k)
) as PermissionKey[];

export function countActivePermissions(permissions: GranularPermissions | undefined | null): number {
  if (!permissions) return 0;
  let count = 0;
  Object.entries(permissions).forEach(([key, val]) => {
    if (!['permissionSchemaVersion', 'dataScope', 'production.scope', 'allowedStages', 'allowedDepartments', 'allowedUsers'].includes(key) && val === true) {
      count++;
    }
  });
  return count;
}

export const PERMISSION_CATEGORY_GROUPS: PermissionCategoryGroup[] = [
  {
    id: 'dashboard',
    nameAr: 'لوحة التحكم والمؤشرات',
    nameEn: 'Dashboard & Analytics',
    icon: 'LayoutDashboard',
    permissions: [
      { key: 'dashboard.view', nameAr: 'عرض لوحة التحكم والمؤشرات الرئيسية (KPIs)', nameEn: 'View Dashboard & KPIs', descriptionAr: 'السماح بالاطلاع على إحصائيات الإنتاج والأطنان', descriptionEn: 'Allow viewing production statistics and tonnage' },
      { key: 'dashboard.export_kpi', nameAr: 'تصدير ملخصات ومؤشرات الأداء', nameEn: 'Export Dashboard KPIs', descriptionAr: 'تصدير بيانات المؤشرات بصيغ ملفات خارجية', descriptionEn: 'Export KPI data to external files' },
    ],
  },
  {
    id: 'production_entry',
    nameAr: 'تسجيل وإدخال الإنتاج',
    nameEn: 'Production Entry',
    icon: 'PlusCircle',
    permissions: [
      { key: 'production.create', nameAr: 'تسجيل عملية إنتاج جديدة (Form)', nameEn: 'Create Production Entry', descriptionAr: 'إدخال سجلات الإنتاج الميدانية للورديات', descriptionEn: 'Enter shift production records via forms' },
      { key: 'production.submit', nameAr: 'تقديم السجل للمراجعة (Submit)', nameEn: 'Submit for Review', descriptionAr: 'إرسال السجل من حالة مسودة إلى قيد المراجعة', descriptionEn: 'Send record from draft to review' },
    ],
  },
  {
    id: 'production_records',
    nameAr: 'سجلات الإنتاج والتعديل',
    nameEn: 'Production Records & Editing',
    icon: 'Layers',
    permissions: [
      { key: 'production.view', nameAr: 'عرض واستعراض سجلات الإنتاج', nameEn: 'View Production Records', descriptionAr: 'السماح باستعراض سجلات الإنتاج', descriptionEn: 'Allow viewing production records' },
      { key: 'production.edit', nameAr: 'تعديل سجلات الإنتاج', nameEn: 'Edit Production Records', descriptionAr: 'تعديل البيانات والأوزان والأعطال', descriptionEn: 'Modify quantities, weights, and faults' },
      { key: 'production.delete', nameAr: 'حذف سجلات الإنتاج نهائياً', nameEn: 'Delete Production Records', descriptionAr: 'صلاحية حذف السجلات نهائياً', descriptionEn: 'Permanently remove records' },
      { key: 'production.correct', nameAr: 'تصحيح السجلات المعتمدة (Correct)', nameEn: 'Correct Records', descriptionAr: 'إجراء تصحيح تدقيقي مع حفظ السجل القديم', descriptionEn: 'Perform audit correction preserving history' },
    ],
  },
  {
    id: 'approval',
    nameAr: 'التدقيق والاعتماد النهائي',
    nameEn: 'Review & Approvals',
    icon: 'CheckCircle2',
    permissions: [
      { key: 'approval.view', nameAr: 'عرض شاشة التدقيق والاعتماد', nameEn: 'View Review & Approvals', descriptionAr: 'الاطلاع على السجلات المعلقة', descriptionEn: 'View pending review records' },
      { key: 'production.review', nameAr: 'فحص وتدقيق السجلات (Review)', nameEn: 'Review Records', descriptionAr: 'فحص جودة السجلات ومطابقة الأرقام', descriptionEn: 'Examine record quality and numbers' },
      { key: 'production.approve', nameAr: 'اعتماد السجلات رسمياً (Approve)', nameEn: 'Approve Single Records', descriptionAr: 'إقرار السجل كإنتاج معتمد نهائي', descriptionEn: 'Approve record as officially verified' },
      { key: 'production.reject', nameAr: 'رفض السجلات مع السبب (Reject)', nameEn: 'Reject Records', descriptionAr: 'رفض السجل مع توضيح السبب للمشغل', descriptionEn: 'Reject record with reason note' },
      { key: 'approval.batch_approve', nameAr: 'الاعتماد الجماعي السريع للسجلات', nameEn: 'Batch Approve Records', descriptionAr: 'اعتماد عدة سجلات دفعة واحدة', descriptionEn: 'Approve multiple records simultaneously' },
    ],
  },
  {
    id: 'stages',
    nameAr: 'صلاحيات المراحل الإنتاجية (8 مراحل)',
    nameEn: '8 Production Stages Access',
    icon: 'Factory',
    permissions: [
      { key: 'stage.pressing', nameAr: 'مرحلة 1: التشكيل والمكابس', nameEn: 'Stage 1: Pressing & Shaping', descriptionAr: 'تسجيل ومراجعة مرحلة المكابس', descriptionEn: 'Pressing stage operations' },
      { key: 'stage.rotary_furnace', nameAr: 'مرحلة 2: الفرن الدوار', nameEn: 'Stage 2: Rotary Furnace', descriptionAr: 'تسجيل ومراجعة حرق الفرن الدوار والغاز', descriptionEn: 'Rotary furnace burning & gas' },
      { key: 'stage.chinese_mills', nameAr: 'مرحلة 3: الطواحين الصينية', nameEn: 'Stage 3: Chinese Mills', descriptionAr: 'تسجيل ومراجعة الطحن الصيني والشيكائر', descriptionEn: 'Chinese milling operations' },
      { key: 'stage.tube_ball_mills', nameAr: 'مرحلة 4: طواحين الأنابيب والكرات', nameEn: 'Stage 4: Tube & Ball Mills', descriptionAr: 'تسجيل ومراجعة طحن البلي والأنبوبي', descriptionEn: 'Tube & ball mill grinding' },
      { key: 'stage.mortar_concrete', nameAr: 'مرحلة 5: المونة والخرسانات', nameEn: 'Stage 5: Mortar & Concrete', descriptionAr: 'تسجيل ومراجعة إنتاج المونات والخرسانة', descriptionEn: 'Mortar & refractory concrete' },
      { key: 'stage.mixing', nameAr: 'مرحلة 6: الخلط والتجهيز', nameEn: 'Stage 6: Mixing & Preparation', descriptionAr: 'تسجيل ومراجعة خلطات المواد الخام', descriptionEn: 'Raw material mixing & prep' },
      { key: 'stage.lightweight_foam', nameAr: 'مرحلة 7: الشاموت الخفيف / الفوم', nameEn: 'Stage 7: Lightweight Foam Chamotte', descriptionAr: 'تسجيل ومراجعة العزل والفوم', descriptionEn: 'Lightweight insulation foam' },
      { key: 'stage.sorting', nameAr: 'مرحلة 8: الفرز والمراقبة النهائية', nameEn: 'Stage 8: Sorting & Quality Inspection', descriptionAr: 'تسجيل وتدقيق عيوب الفرز والشطف والشروخ', descriptionEn: 'Defect inspection & sorting' },
    ],
  },
  {
    id: 'masterdata',
    nameAr: 'البيانات الأساسية والإضافة المباشرة',
    nameEn: 'Master Data & Inline Add',
    icon: 'Database',
    permissions: [
      { key: 'masterdata.view', nameAr: 'عرض شاشات البيانات الأساسية', nameEn: 'View Master Data Directory', descriptionAr: 'الاطلاع على القوائم الأساسية للمصنع', descriptionEn: 'View factory master data lists' },
      { key: 'masterData.inlineAdd', nameAr: 'الإضافة المباشرة السريعة من القوائم المنسدلة (+)', nameEn: 'Inline Add from Dropdowns (+)', descriptionAr: 'إضافة عمال ومنتجات ومكابس مباشرة أثناء التسجيل', descriptionEn: 'Quickly register master items directly from entry forms' },
      { key: 'employees.view', nameAr: 'عرض سجلات العمال والمشغلين', nameEn: 'View Employees', descriptionAr: 'استعراض بيانات العمال وأكوادهم', descriptionEn: 'View employee directory' },
      { key: 'employees.create', nameAr: 'إضافة عامل جديد', nameEn: 'Add Employee', descriptionAr: 'تسجيل كود واسم عامل جديد', descriptionEn: 'Register new employee code & name' },
      { key: 'employees.edit', nameAr: 'تعديل بيانات العامل', nameEn: 'Edit Employee', descriptionAr: 'تعديل الاسم أو القسم أو الحالة', descriptionEn: 'Update employee details' },
      { key: 'employees.delete', nameAr: 'حذف سجل العامل', nameEn: 'Delete Employee', descriptionAr: 'إلغاء أو حذف بيانات العامل', descriptionEn: 'Remove employee record' },
      { key: 'products.view', nameAr: 'عرض كتالوج المنتجات والأصناف', nameEn: 'View Products Catalog', descriptionAr: 'الاطلاع على أصناف الطوب والحراريات', descriptionEn: 'View refractory products catalog' },
      { key: 'products.create', nameAr: 'إضافة منتج وكود صنف جديد', nameEn: 'Add New Product', descriptionAr: 'إنشاء كود منتج وأوزان قطع', descriptionEn: 'Create product code and piece weights' },
      { key: 'products.edit', nameAr: 'تعديل المنتجات وأوزان القطع', nameEn: 'Edit Product & Piece Weight', descriptionAr: 'تعديل نسبة الألومينا والأوزان بالكيلوجرام', descriptionEn: 'Edit alumina % and kg piece weight' },
      { key: 'products.delete', nameAr: 'حذف منتج من الكتالوج', nameEn: 'Delete Product', descriptionAr: 'حذف المنتج من الكتالوج', descriptionEn: 'Remove product from catalog' },
      { key: 'customers.view', nameAr: 'عرض بيانات العملاء والشركات', nameEn: 'View Customers', descriptionAr: 'الاطلاع على قائمة العملاء والطلبيات', descriptionEn: 'View customers list' },
      { key: 'customers.create', nameAr: 'إضافة عميل أو شركة جديدة', nameEn: 'Add Customer', descriptionAr: 'تسجيل شركة أو عميل جديد', descriptionEn: 'Register new customer' },
      { key: 'customers.edit', nameAr: 'تعديل بيانات العميل', nameEn: 'Edit Customer', descriptionAr: 'تحديث بيانات التواصل أو الكود', descriptionEn: 'Update customer details' },
      { key: 'customers.delete', nameAr: 'حذف عميل', nameEn: 'Delete Customer', descriptionAr: 'حذف العميل من القائمة', descriptionEn: 'Remove customer' },
      { key: 'presses.view', nameAr: 'عرض المكابس ومعدات التشكيل', nameEn: 'View Presses', descriptionAr: 'استعراض المكابس وطاقاتها', descriptionEn: 'View presses and capacities' },
      { key: 'presses.create', nameAr: 'إضافة مكبس جديد', nameEn: 'Add Press', descriptionAr: 'تسجيل مكبس جديد وطاقته', descriptionEn: 'Register new press' },
      { key: 'presses.edit', nameAr: 'تعديل بيانات المكابس', nameEn: 'Edit Presses', descriptionAr: 'تحديث حالة وضغط المكبس', descriptionEn: 'Update press status & tonnage' },
      { key: 'presses.delete', nameAr: 'حذف مكبس', nameEn: 'Delete Press', descriptionAr: 'حذف المكبس من المنظومة', descriptionEn: 'Remove press' },
      { key: 'furnaces.view', nameAr: 'عرض الأفران', nameEn: 'View Furnaces', descriptionAr: 'استعراض الأفران وطاقتها', descriptionEn: 'View furnaces' },
      { key: 'furnaces.create', nameAr: 'إضافة فرن جديد', nameEn: 'Add Furnace', descriptionAr: 'تسجيل فرن جديد', descriptionEn: 'Register new furnace' },
      { key: 'furnaces.edit', nameAr: 'تعديل بيانات الأفران', nameEn: 'Edit Furnaces', descriptionAr: 'تعديل سعة الفرن ومواصفاته', descriptionEn: 'Update furnace specs' },
      { key: 'furnaces.delete', nameAr: 'حذف فرن', nameEn: 'Delete Furnace', descriptionAr: 'حذف الفرن من المنظومة', descriptionEn: 'Remove furnace' },
      { key: 'furnaceCars.view', nameAr: 'عرض عربات الأفران', nameEn: 'View Furnace Cars', descriptionAr: 'استعراض أرقام عربات الأفران', descriptionEn: 'View furnace car numbers' },
      { key: 'furnaceCars.create', nameAr: 'إضافة عربة فرن جديدة', nameEn: 'Add Furnace Car', descriptionAr: 'تسجيل كود ورقم عربة جديد', descriptionEn: 'Register new car number' },
      { key: 'furnaceCars.edit', nameAr: 'تعديل عربات الأفران', nameEn: 'Edit Furnace Cars', descriptionAr: 'تعديل حالة وبيانات العربة', descriptionEn: 'Update car status' },
      { key: 'furnaceCars.delete', nameAr: 'حذف عربة فرن', nameEn: 'Delete Furnace Car', descriptionAr: 'حذف العربة من السجلات', descriptionEn: 'Remove car' },
      { key: 'shifts.view', nameAr: 'عرض الورديات', nameEn: 'View Shifts', descriptionAr: 'الاطلاع على مواعيد وورديات المصنع', descriptionEn: 'View shift timings' },
      { key: 'shifts.create', nameAr: 'إضافة وردية جديدة', nameEn: 'Add Shift', descriptionAr: 'تسجيل وردية جديدة', descriptionEn: 'Register new shift' },
      { key: 'shifts.edit', nameAr: 'تعديل الورديات', nameEn: 'Edit Shifts', descriptionAr: 'تعديل ساعات الوردية', descriptionEn: 'Update shift hours' },
      { key: 'shifts.delete', nameAr: 'حذف وردية', nameEn: 'Delete Shift', descriptionAr: 'حذف الوردية من القائمة', descriptionEn: 'Remove shift' },
      { key: 'materials.view', nameAr: 'عرض الخامات والمواد الأولية والمخزون', nameEn: 'View Raw Materials & Stock', descriptionAr: 'الاطلاع على أرصدة الخامات والشاموت', descriptionEn: 'View raw materials & chamotte stock' },
      { key: 'materials.create', nameAr: 'إضافة خامة جديدة', nameEn: 'Add Raw Material', descriptionAr: 'تسجيل خامة جديدة ووحدة قياس', descriptionEn: 'Register new material & unit' },
      { key: 'materials.edit', nameAr: 'تعديل الخامات والمخزون', nameEn: 'Edit Material & Stock', descriptionAr: 'تحديث أرصدة الخامات وتكاليفها', descriptionEn: 'Update stock levels & costs' },
      { key: 'materials.delete', nameAr: 'حذف خامة', nameEn: 'Delete Material', descriptionAr: 'حذف الخامة من الدليل', descriptionEn: 'Remove material' },
      { key: 'inventory.view', nameAr: 'عرض أرصدة وحركات المخازن', nameEn: 'View Inventory Movements', descriptionAr: 'متابعة الوارد والمنصرف من المخزن', descriptionEn: 'Track inventory in/out' },
      { key: 'inventory.manage', nameAr: 'إدارة أذون الصرف والتسوية المخزنية', nameEn: 'Manage Inventory & Adjustments', descriptionAr: 'تسوية الجرد وتسجيل الحركات', descriptionEn: 'Stock reconciliation & issuing' },
      { key: 'machines.view', nameAr: 'عرض خطوط ومعدات المصنع', nameEn: 'View Factory Machinery', descriptionAr: 'استعراض المعدات والخطوط', descriptionEn: 'View machinery catalog' },
      { key: 'machines.create', nameAr: 'إضافة معدة أو خط إنتاج', nameEn: 'Add Machinery', descriptionAr: 'تسجيل ماكينة جديدة', descriptionEn: 'Register new machine' },
      { key: 'machines.edit', nameAr: 'تعديل بيانات المعدات', nameEn: 'Edit Machinery', descriptionAr: 'تحديث الصيانة ومواصفات الخط', descriptionEn: 'Update machine specs' },
      { key: 'machines.delete', nameAr: 'حذف معدة', nameEn: 'Delete Machinery', descriptionAr: 'حذف الماكينة من السجل', descriptionEn: 'Remove machine' },
    ],
  },
  {
    id: 'historical_import',
    nameAr: 'استيراد الإنتاج التاريخي والمطابقة الذكية',
    nameEn: 'Historical Import & Smart Matching',
    icon: 'UploadCloud',
    permissions: [
      { key: 'excel.import', nameAr: 'استيراد سجلات الإنتاج من Excel', nameEn: 'Import Excel Files', descriptionAr: 'رفع وقراءة ملفات الإكسل التاريخية', descriptionEn: 'Upload and parse historical Excel files' },
      { key: 'historical.import.view', nameAr: 'عرض شاشة استيراد الإنتاج التاريخي', nameEn: 'View Historical Import Center', descriptionAr: 'استعراض شاشة الاستيراد والتوليد', descriptionEn: 'Access historical import dashboard' },
      { key: 'historical.import.approve_matching', nameAr: 'اعتماد قرارات المطابقة الذكية (Smart Matching Review)', nameEn: 'Approve Smart Matches', descriptionAr: 'مراجعة وتأكيد أو تعديل اقتراحات المطابقة', descriptionEn: 'Review, accept, or reject fuzzy match proposals' },
      { key: 'historical.import.execute', nameAr: 'تنفيذ وكتابة الاستيراد إلى Firestore', nameEn: 'Commit Batch Import to Firestore', descriptionAr: 'حفظ السجلات بعد اعتماد المطابقات', descriptionEn: 'Write validated records to Firestore database' },
      { key: 'historical.import.undo', nameAr: 'التراجع عن دفعة استيراد (Undo Import)', nameEn: 'Undo Import Batch', descriptionAr: 'إلغاء وحذف السجلات المرتبطة برقم دفعة استيراد', descriptionEn: 'Rollback records associated with import batch' },
      { key: 'historical.import.backup_before', nameAr: 'توليد نسخة أمان وقائية قبل الاستيراد', nameEn: 'Create Safety Backup Before Import', descriptionAr: 'أخذ نسخة تلقائية لقاعدة البيانات قبل الحفظ', descriptionEn: 'Generate snapshot before batch writing' },
    ],
  },
  {
    id: 'reports_excel',
    nameAr: 'التقارير وتصدير الجداول',
    nameEn: 'Reports & Excel Exports',
    icon: 'FileSpreadsheet',
    permissions: [
      { key: 'reports.view', nameAr: 'عرض شاشة التقارير والرسوم البيانية', nameEn: 'View Analytical Reports', descriptionAr: 'الاطلاع على تقارير الإنتاج والهالك والأطنان', descriptionEn: 'View production, waste, and ton reports' },
      { key: 'reports.export', nameAr: 'تصدير التقارير إلى Excel و PDF', nameEn: 'Export Reports (Excel/PDF)', descriptionAr: 'تنزيل التقارير مع حسابات الأطنان', descriptionEn: 'Download reports with ton calculations' },
      { key: 'reports.custom_queries', nameAr: 'الاستعلامات المتقدمة متعددة الأبعاد', nameEn: 'Advanced Multi-Dimension Queries', descriptionAr: 'تصفية التقارير حسب المكبس والعامل والتاريخ والفرن', descriptionEn: 'Filter by press, worker, date, and furnace' },
      { key: 'excel.export', nameAr: 'تصدير أي جدول بيانات إلى XLSX', nameEn: 'Export Tables to Excel', descriptionAr: 'تصدير أي جدول أو قائمة بصيغة XLSX', descriptionEn: 'Export tables to XLSX' },
      { key: 'excel.template_download', nameAr: 'تنزيل قوالب الإكسل المعتمدة', nameEn: 'Download Excel Templates', descriptionAr: 'تنزيل شيت إكسل القياسي المخصص للإدخال', descriptionEn: 'Download standard entry templates' },
    ],
  },
  {
    id: 'ai',
    nameAr: 'المساعد الذكي وتحليلات المصنع',
    nameEn: 'AI Factory Assistant',
    icon: 'Sparkles',
    permissions: [
      { key: 'ai.use', nameAr: 'استخدام المساعد الذكي لمصنع عصفور', nameEn: 'Use AI Factory Assistant', descriptionAr: 'طرح استفسارات باللغة الطبيعية حول الإنتاج والأعطال', descriptionEn: 'Natural language queries on production & faults' },
      { key: 'ai.advanced_analysis', nameAr: 'التحليلات التنبؤية وكشف شذوذ الأوزان والهالك', nameEn: 'Predictive & Anomaly Analytics', descriptionAr: 'استخراج أنماط الأعطال وتوصيات تحسين كفاءة الخطوط', descriptionEn: 'Extract fault patterns & efficiency recommendations' },
    ],
  },
  {
    id: 'users',
    nameAr: 'إدارة المستخدمين والصلاحيات والتدقيق',
    nameEn: 'Users & Permissions Administration',
    icon: 'Users',
    permissions: [
      { key: 'users.view', nameAr: 'عرض دليل المستخدمين والحسابات', nameEn: 'View User Directory', descriptionAr: 'استعراض الحسابات المسجلة والأدوار', descriptionEn: 'View registered users & roles' },
      { key: 'users.create', nameAr: 'إنشاء حساب مستخدم جديد (Firebase Auth)', nameEn: 'Create System User', descriptionAr: 'إنشاء بريد وكلمة مرور وتحديد الدور', descriptionEn: 'Create email, password, and assign role' },
      { key: 'users.edit', nameAr: 'تعديل بيانات المستخدم وربط كود العامل', nameEn: 'Edit User & Link Employee Code', descriptionAr: 'تحديث بيانات المستخدم وربطه بعامل مصنع', descriptionEn: 'Update user profile & link to employee' },
      { key: 'users.activate', nameAr: 'تفعيل حساب المستخدم', nameEn: 'Activate User', descriptionAr: 'السماح للمستخدم بالدخول للنظام', descriptionEn: 'Allow user system access' },
      { key: 'users.deactivate', nameAr: 'تعطيل حساب المستخدم', nameEn: 'Deactivate User', descriptionAr: 'إيقاف الدخول مؤقتاً دون حذف البيانات', descriptionEn: 'Temporarily suspend access' },
      { key: 'users.reset_password', nameAr: 'إعادة تعيين كلمة المرور', nameEn: 'Reset User Password', descriptionAr: 'إرسال رابط استعادة أو تحديث كلمة المرور', descriptionEn: 'Send password reset link' },
      { key: 'users.change_role', nameAr: 'تغيير الدور الوظيفي للمستخدم', nameEn: 'Change User Role', descriptionAr: 'الترقية أو التعيين لأدوار مختلفة', descriptionEn: 'Promote or reassign roles' },
      { key: 'users.manage_permissions', nameAr: 'تخصيص الصلاحيات الفردية الدقيقة للمستخدم', nameEn: 'Customize Granular Permissions', descriptionAr: 'تحديد مربعات الاختيار الفردية لكل مستخدم', descriptionEn: 'Toggle individual permission checkboxes' },
      { key: 'permissions.view', nameAr: 'عرض شاشة محرر الصلاحيات', nameEn: 'View Permissions Editor', descriptionAr: 'الاطلاع على صلاحيات المستخدمين', descriptionEn: 'View user permissions' },
      { key: 'permissions.edit', nameAr: 'حفظ وتحديث مصفوفة الصلاحيات مع سجل التغيير', nameEn: 'Save Permission Overrides & Audit Log', descriptionAr: 'حفظ التعديلات في قاعدة البيانات مع تدوين السبب', descriptionEn: 'Commit permission updates with audit trail' },
    ],
  },
  {
    id: 'backup_restore',
    nameAr: 'النسخ الاحتياطي واستعادة البيانات',
    nameEn: 'Disaster Recovery & Backups',
    icon: 'HardDrive',
    permissions: [
      { key: 'backup.view', nameAr: 'عرض مركز النسخ الاحتياطي وسجلات النسخ', nameEn: 'View Backup Center', descriptionAr: 'استعراض النسخ الاحتياطية وتواريخها', descriptionEn: 'View backup history & dates' },
      { key: 'backup.create', nameAr: 'إنشاء نسخة احتياطية فورية (Manual Backup)', nameEn: 'Create Manual Backup', descriptionAr: 'أخذ نسخة كاملة من مجموعات Firestore', descriptionEn: 'Take complete snapshot of Firestore' },
      { key: 'backup.download', nameAr: 'تنزيل ملف النسخة الاحتياطية كملف JSON مشفر', nameEn: 'Download Backup JSON File', descriptionAr: 'حفظ ملف النسخة على القرص المحلي', descriptionEn: 'Save backup file locally' },
      { key: 'backup.delete', nameAr: 'حذف نسخ احتياطية قديمة', nameEn: 'Delete Old Backups', descriptionAr: 'إلغاء وحذف ملفات النسخ السابقة', descriptionEn: 'Remove legacy backups' },
      { key: 'restore.view', nameAr: 'عرض مركز الاستعادة ومعاينة الفروقات', nameEn: 'View Restore Center & Preview Diffs', descriptionAr: 'الاطلاع على تفاصيل الاستعادة ومطابقة الأرقام', descriptionEn: 'Preview restoration diffs & counts' },
      { key: 'restore.execute', nameAr: 'تنفيذ استعادة البيانات الآمنة (Safety Checkpoint Restore)', nameEn: 'Execute Safe Restore', descriptionAr: 'صلاحية حساسة لاسترجاع البيانات من نسخة سابقة', descriptionEn: 'Critical permission to restore from snapshot' },
    ],
  },
  {
    id: 'system_admin',
    nameAr: 'إدارة النظام وصحة الاتصال والهوية المؤسسية',
    nameEn: 'System Health, Settings & Branding',
    icon: 'ShieldCheck',
    permissions: [
      { key: 'system.view', nameAr: 'عرض حالة النظام والاتصال السحابي', nameEn: 'View System State', descriptionAr: 'مراقبة حالة الجلسات والاتصال', descriptionEn: 'Monitor session and connectivity' },
      { key: 'system.health.view', nameAr: 'عرض مؤشرات صحة النظام وزمن استجابة Firestore', nameEn: 'View System Health & Latency', descriptionAr: 'مراقبة زمن استجابة الاستعلامات وحالة السحابة', descriptionEn: 'Monitor query latency and cloud status' },
      { key: 'system.manage', nameAr: 'إدارة إعدادات النظام المتقدمة', nameEn: 'Manage Advanced Settings', descriptionAr: 'التحكم بالبروتوكولات ونسخ المخطط (Schema)', descriptionEn: 'Manage protocols & schema version' },
      { key: 'audit.view', nameAr: 'عرض سجل التدقيق والأنشطة الأمنية (Audit Logs)', nameEn: 'View Security Audit Logs', descriptionAr: 'متابعة سجل حركات الدخول والتعديلات والحذف', descriptionEn: 'Review login, update, and delete audit trails' },
      { key: 'settings.view', nameAr: 'عرض شاشة الإعدادات العامة', nameEn: 'View Settings Page', descriptionAr: 'الاطلاع على بيانات المنظومة والنسخ', descriptionEn: 'View system configuration' },
      { key: 'settings.edit', nameAr: 'تعديل إعدادات وتفضيلات النظام', nameEn: 'Edit System Settings', descriptionAr: 'تحديث تفضيلات المنظومة', descriptionEn: 'Update system preferences' },
      { key: 'branding.view', nameAr: 'عرض إعدادات الشعار والهوية المؤسسية', nameEn: 'View Branding Settings', descriptionAr: 'استعراض شعار شركة عصفور وصورة المهندس المطور', descriptionEn: 'View company logo & developer asset' },
      { key: 'branding.edit', nameAr: 'تحديث وتثبيت شعار شركة عصفور', nameEn: 'Update Company Logo Asset', descriptionAr: 'رفع وتثبيت الشعار المؤسسي بدون تعديل اصطناعي', descriptionEn: 'Upload & persist original branding assets' },
      { key: 'versions.view', nameAr: 'عرض سجل إصدارات المنظومة وتاريخ التحديثات', nameEn: 'View System Version History', descriptionAr: 'استعراض أرقام الإصدارات وملاحظات النشر', descriptionEn: 'Review release notes & deployment history' },
    ],
  },
  {
    id: 'field_restrictions',
    nameAr: 'حماية وتقييد الحقول الحساسة',
    nameEn: 'Sensitive Field Restrictions',
    icon: 'EyeOff',
    permissions: [
      { key: 'fields.view_tonnage', nameAr: 'عرض أوزان الأطنان وحسابات الإنتاجية', nameEn: 'View Tonnage & Weight KPIs', descriptionAr: 'الاطلاع على الإنتاج والهالك المحسوب بالأطنان', descriptionEn: 'View ton calculations across records & dashboard' },
      { key: 'fields.view_cost', nameAr: 'عرض التكاليف وأسعار الخامات والمنتجات', nameEn: 'View Financial Costs & Pricing', descriptionAr: 'الاطلاع على التكاليف المالية للطن والخامات', descriptionEn: 'View financial numbers & material costs' },
      { key: 'fields.view_consumption', nameAr: 'عرض استهلاك الغاز والكهرباء لكل طن', nameEn: 'View Gas & Electricity Consumption', descriptionAr: 'متابعة استهلاك الطاقة للفرن الدوار', descriptionEn: 'Track energy consumption per ton' },
      { key: 'fields.edit_downtime', nameAr: 'تسجيل وتعديل دقائق وفئات الأعطال والتوقفات', nameEn: 'Record & Edit Fault Downtimes', descriptionAr: 'السماح بتعديل أوقات أعطال الميكانيكا والكهرباء والورشة', descriptionEn: 'Modify mechanical, electrical, and workshop fault minutes' },
    ],
  },
];

export const PERMISSION_CATEGORIES = PERMISSION_CATEGORY_GROUPS;

/**
 * ASFOUR ERP - Granular Permissions and Role Definitions
 * Defines fine-grained access rights across operations, master data, analytics, administration, and system tools.
 */

export type UserRole = 
  | 'SUPER_ADMIN' 
  | 'ADMIN' 
  | 'SUPERVISOR'
  | 'PRODUCTION_SUPERVISOR' 
  | 'PRODUCTION_OPERATOR' 
  | 'QUALITY_CONTROL' 
  | 'DATA_ENTRY' 
  | 'ACCOUNTING' 
  | 'REPORT_VIEWER' 
  | 'MAINTENANCE' 
  | 'PRODUCTION_USER' // legacy alias for backward compatibility
  | 'VIEWER'
  | 'CUSTOM';

export type ProductionScope = 'all' | 'shift' | 'own';

export interface GranularPermissions {
  // 1. Dashboard & Analytics
  'dashboard.view': boolean;
  'dashboard.export_kpi': boolean;

  // 2. Production Operations
  'production.view': boolean;
  'production.scope': ProductionScope;
  'production.create': boolean;
  'production.edit': boolean;
  'production.delete': boolean;
  'production.submit': boolean;
  'production.review': boolean;
  'production.approve': boolean;
  'production.reject': boolean;
  'production.correct': boolean;

  // 3. Specific Production Stages
  'stage.pressing': boolean;
  'stage.rotary_furnace': boolean;
  'stage.chinese_mills': boolean;
  'stage.tube_ball_mills': boolean;
  'stage.mortar_concrete': boolean;
  'stage.mixing': boolean;
  'stage.lightweight_foam': boolean;
  'stage.sorting': boolean;

  // 4. Master Data
  'masterdata.view': boolean;
  'employees.view': boolean;
  'employees.create': boolean;
  'employees.edit': boolean;
  'employees.delete': boolean;
  
  'products.view': boolean;
  'products.create': boolean;
  'products.edit': boolean;
  'products.delete': boolean;

  'customers.view': boolean;
  'customers.create': boolean;
  'customers.edit': boolean;
  'customers.delete': boolean;

  'presses.view': boolean;
  'presses.create': boolean;
  'presses.edit': boolean;
  'presses.delete': boolean;

  'furnaces.view': boolean;
  'furnaces.create': boolean;
  'furnaces.edit': boolean;
  'furnaces.delete': boolean;

  'materials.view': boolean;
  'materials.create': boolean;
  'materials.edit': boolean;
  'materials.delete': boolean;

  'machines.view': boolean;
  'machines.create': boolean;
  'machines.edit': boolean;
  'machines.delete': boolean;

  // 5. Reports & Exports
  'reports.view': boolean;
  'reports.export': boolean;
  'reports.custom_queries': boolean;

  // 6. Excel Data Management
  'excel.import': boolean;
  'excel.export': boolean;
  'excel.template_download': boolean;

  // 7. AI Factory Assistant
  'ai.use': boolean;
  'ai.advanced_analysis': boolean;

  // 8. User Management
  'users.view': boolean;
  'users.create': boolean;
  'users.edit': boolean;
  'users.activate': boolean;
  'users.deactivate': boolean;
  'users.reset_password': boolean;
  'users.change_role': boolean;
  'users.manage_permissions': boolean;

  // 9. Disaster Recovery & Backups
  'backup.view': boolean;
  'backup.create': boolean;
  'backup.download': boolean;
  'backup.delete': boolean;
  'restore.view': boolean;
  'restore.execute': boolean;

  // 10. System Administration
  'system.view': boolean;
  'system.manage': boolean;
  'audit.view': boolean;
  'settings.view': boolean;
  'settings.edit': boolean;
}

export type PermissionKey = keyof GranularPermissions;

export interface PermissionCategoryGroup {
  id: string;
  nameAr: string;
  nameEn: string;
  icon: string;
  permissions: {
    key: PermissionKey;
    nameAr: string;
    nameEn: string;
    descriptionAr: string;
    descriptionEn: string;
  }[];
}

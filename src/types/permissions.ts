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

export type DataScopeType = 
  | 'ALL' 
  | 'OWN_RECORDS' 
  | 'OWN_DEPARTMENT' 
  | 'OWN_SHIFT' 
  | 'SELECTED_STAGES' 
  | 'SELECTED_DEPARTMENTS' 
  | 'SELECTED_USERS' 
  | 'CUSTOM';

export interface GranularPermissions {
  // Schema version for future-proof migrations
  permissionSchemaVersion?: number;

  // Data Visibility / Scope
  dataScope?: DataScopeType;
  'production.scope'?: ProductionScope;
  allowedStages?: string[];
  allowedDepartments?: string[];
  allowedUsers?: string[];

  // 1. Dashboard & Analytics
  'dashboard.view': boolean;
  'dashboard.export_kpi': boolean;

  // 2. Production Entry & Direct Operations
  'production.view': boolean;
  'production.create': boolean;
  'production.edit': boolean;
  'production.delete': boolean;
  'production.submit': boolean;
  'production.review': boolean;
  'production.approve': boolean;
  'production.reject': boolean;
  'production.correct': boolean;

  // 3. Approval Dedicated Rights
  'approval.view': boolean;
  'approval.approve': boolean;
  'approval.reject': boolean;
  'approval.batch_approve': boolean;

  // 4. Specific Production Stages (8 Stages)
  'stage.pressing': boolean;
  'stage.rotary_furnace': boolean;
  'stage.chinese_mills': boolean;
  'stage.tube_ball_mills': boolean;
  'stage.mortar_concrete': boolean;
  'stage.mixing': boolean;
  'stage.lightweight_foam': boolean;
  'stage.sorting': boolean;

  // 5. Master Data & Inline Add
  'masterdata.view': boolean;
  'masterData.inlineAdd': boolean; // Dedicated permission to add new Master Data from dropdowns

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

  'furnaceCars.view': boolean;
  'furnaceCars.create': boolean;
  'furnaceCars.edit': boolean;
  'furnaceCars.delete': boolean;

  'shifts.view': boolean;
  'shifts.create': boolean;
  'shifts.edit': boolean;
  'shifts.delete': boolean;

  'materials.view': boolean;
  'materials.create': boolean;
  'materials.edit': boolean;
  'materials.delete': boolean;

  'inventory.view': boolean;
  'inventory.manage': boolean;

  'machines.view': boolean;
  'machines.create': boolean;
  'machines.edit': boolean;
  'machines.delete': boolean;

  // 6. Historical Import & Smart Matching
  'excel.import': boolean;
  'historical.import.view': boolean;
  'historical.import.execute': boolean;
  'historical.import.approve_matching': boolean;
  'historical.import.undo': boolean;
  'historical.import.backup_before': boolean;

  // 7. Excel Export & Templates
  'excel.export': boolean;
  'excel.template_download': boolean;

  // 8. Reports & Analytics
  'reports.view': boolean;
  'reports.export': boolean;
  'reports.custom_queries': boolean;

  // 9. AI Factory Assistant
  'ai.use': boolean;
  'ai.advanced_analysis': boolean;

  // 10. User & Permission Management
  'users.view': boolean;
  'users.create': boolean;
  'users.edit': boolean;
  'users.activate': boolean;
  'users.deactivate': boolean;
  'users.reset_password': boolean;
  'users.change_role': boolean;
  'users.manage_permissions': boolean;
  'permissions.view': boolean;
  'permissions.edit': boolean;

  // 11. Disaster Recovery & Backups
  'backup.view': boolean;
  'backup.create': boolean;
  'backup.download': boolean;
  'backup.delete': boolean;
  'restore.view': boolean;
  'restore.execute': boolean;

  // 12. System Health, Audit, Settings, Branding, Versions
  'system.view': boolean;
  'system.health.view': boolean;
  'system.manage': boolean;
  'audit.view': boolean;
  'settings.view': boolean;
  'settings.edit': boolean;
  'branding.view': boolean;
  'branding.edit': boolean;
  'versions.view': boolean;

  // 13. Sensitive Field / Domain Restrictions
  'fields.view_cost': boolean;
  'fields.edit_downtime': boolean;
  'fields.view_consumption': boolean;
  'fields.view_tonnage': boolean;
}

export type PermissionKey = keyof Omit<
  GranularPermissions, 
  'permissionSchemaVersion' | 'dataScope' | 'production.scope' | 'allowedStages' | 'allowedDepartments' | 'allowedUsers'
>;

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

export interface PermissionAuditEntry {
  id?: string;
  userId: string;
  employeeId?: string;
  employeeName?: string;
  userEmail?: string;
  changedBy: string;
  changedByName?: string;
  timestamp: string;
  oldPermissions: Record<string, any>;
  newPermissions: Record<string, any>;
  reason?: string;
}


/**
 * ASFOUR ERP - Permission Presets & Access Control Evaluator
 */
import { GranularPermissions, PermissionKey, UserRole, PermissionCategoryGroup } from '../types/permissions';
import { AdminUser, NavigationPage } from '../types';

export const DEFAULT_SUPER_ADMIN_PERMISSIONS: GranularPermissions = {
  'dashboard.view': true,
  'dashboard.export_kpi': true,
  'production.view': true,
  'production.scope': 'all',
  'production.create': true,
  'production.edit': true,
  'production.delete': true,
  'production.submit': true,
  'production.review': true,
  'production.approve': true,
  'production.reject': true,
  'production.correct': true,
  'stage.pressing': true,
  'stage.rotary_furnace': true,
  'stage.chinese_mills': true,
  'stage.tube_ball_mills': true,
  'stage.mortar_concrete': true,
  'stage.mixing': true,
  'stage.lightweight_foam': true,
  'stage.sorting': true,
  'masterdata.view': true,
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
  'materials.view': true,
  'materials.create': true,
  'materials.edit': true,
  'materials.delete': true,
  'machines.view': true,
  'machines.create': true,
  'machines.edit': true,
  'machines.delete': true,
  'reports.view': true,
  'reports.export': true,
  'reports.custom_queries': true,
  'excel.import': true,
  'excel.export': true,
  'excel.template_download': true,
  'ai.use': true,
  'ai.advanced_analysis': true,
  'users.view': true,
  'users.create': true,
  'users.edit': true,
  'users.activate': true,
  'users.deactivate': true,
  'users.reset_password': true,
  'users.change_role': true,
  'users.manage_permissions': true,
  'backup.view': true,
  'backup.create': true,
  'backup.download': true,
  'backup.delete': true,
  'restore.view': true,
  'restore.execute': true,
  'system.view': true,
  'system.manage': true,
  'audit.view': true,
  'settings.view': true,
  'settings.edit': true,
};

export const DEFAULT_PRODUCTION_OPERATOR_PERMISSIONS: GranularPermissions = {
  'dashboard.view': false,
  'dashboard.export_kpi': false,
  'production.view': true,
  'production.scope': 'own',
  'production.create': true,
  'production.edit': true,
  'production.delete': false,
  'production.submit': true,
  'production.review': false,
  'production.approve': false,
  'production.reject': false,
  'production.correct': false,
  'stage.pressing': true,
  'stage.rotary_furnace': true,
  'stage.chinese_mills': true,
  'stage.tube_ball_mills': true,
  'stage.mortar_concrete': true,
  'stage.mixing': true,
  'stage.lightweight_foam': true,
  'stage.sorting': true,
  'masterdata.view': false,
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
  'materials.view': false,
  'materials.create': false,
  'materials.edit': false,
  'materials.delete': false,
  'machines.view': false,
  'machines.create': false,
  'machines.edit': false,
  'machines.delete': false,
  'reports.view': false,
  'reports.export': false,
  'reports.custom_queries': false,
  'excel.import': false,
  'excel.export': false,
  'excel.template_download': false,
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
  'backup.view': false,
  'backup.create': false,
  'backup.download': false,
  'backup.delete': false,
  'restore.view': false,
  'restore.execute': false,
  'system.view': false,
  'system.manage': false,
  'audit.view': false,
  'settings.view': false,
  'settings.edit': false,
};

export const DEFAULT_PRODUCTION_SUPERVISOR_PERMISSIONS: GranularPermissions = {
  ...DEFAULT_PRODUCTION_OPERATOR_PERMISSIONS,
  'dashboard.view': true,
  'dashboard.export_kpi': true,
  'production.view': true,
  'production.scope': 'shift',
  'production.create': true,
  'production.edit': true,
  'production.delete': false,
  'production.submit': true,
  'production.review': true,
  'production.approve': true,
  'production.reject': true,
  'production.correct': true,
  'masterdata.view': true,
  'employees.view': true,
  'products.view': true,
  'customers.view': true,
  'presses.view': true,
  'furnaces.view': true,
  'materials.view': true,
  'machines.view': true,
  'reports.view': true,
  'reports.export': true,
  'excel.export': true,
  'excel.template_download': true,
  'ai.use': true,
};

export const DEFAULT_QUALITY_CONTROL_PERMISSIONS: GranularPermissions = {
  ...DEFAULT_PRODUCTION_OPERATOR_PERMISSIONS,
  'dashboard.view': true,
  'production.view': true,
  'production.scope': 'all',
  'production.create': false,
  'production.edit': false,
  'production.delete': false,
  'production.submit': false,
  'production.review': true,
  'production.approve': true,
  'production.reject': true,
  'production.correct': true,
  'masterdata.view': true,
  'products.view': true,
  'reports.view': true,
  'reports.export': true,
  'excel.export': true,
  'ai.use': true,
};

export const DEFAULT_DATA_ENTRY_PERMISSIONS: GranularPermissions = {
  ...DEFAULT_PRODUCTION_OPERATOR_PERMISSIONS,
  'dashboard.view': true,
  'production.view': true,
  'production.scope': 'all',
  'production.create': true,
  'production.edit': true,
  'production.delete': false,
  'production.submit': true,
  'production.review': false,
  'production.approve': false,
  'masterdata.view': true,
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
  'materials.view': true,
  'excel.import': true,
  'excel.export': true,
  'excel.template_download': true,
};

export const DEFAULT_ACCOUNTING_PERMISSIONS: GranularPermissions = {
  ...DEFAULT_PRODUCTION_OPERATOR_PERMISSIONS,
  'dashboard.view': true,
  'dashboard.export_kpi': true,
  'production.view': true,
  'production.scope': 'all',
  'production.create': false,
  'production.edit': false,
  'masterdata.view': true,
  'materials.view': true,
  'reports.view': true,
  'reports.export': true,
  'reports.custom_queries': true,
  'excel.export': true,
};

export const DEFAULT_REPORT_VIEWER_PERMISSIONS: GranularPermissions = {
  ...DEFAULT_PRODUCTION_OPERATOR_PERMISSIONS,
  'dashboard.view': true,
  'dashboard.export_kpi': true,
  'production.view': true,
  'production.scope': 'all',
  'production.create': false,
  'production.edit': false,
  'masterdata.view': true,
  'reports.view': true,
  'reports.export': true,
  'excel.export': true,
};

export const DEFAULT_MAINTENANCE_PERMISSIONS: GranularPermissions = {
  ...DEFAULT_PRODUCTION_OPERATOR_PERMISSIONS,
  'dashboard.view': true,
  'production.view': true,
  'production.scope': 'all',
  'presses.view': true,
  'presses.edit': true,
  'furnaces.view': true,
  'furnaces.edit': true,
  'machines.view': true,
  'machines.edit': true,
  'reports.view': true,
  'system.view': true,
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

export function resolveUserPermissions(user: AdminUser | null | undefined): GranularPermissions {
  if (!user) {
    return DEFAULT_PRODUCTION_OPERATOR_PERMISSIONS;
  }
  if (user.role === 'SUPER_ADMIN') {
    return DEFAULT_SUPER_ADMIN_PERMISSIONS;
  }
  const base = getRolePresetPermissions(user.role);
  if (user.permissions) {
    return {
      ...base,
      ...(user.permissions as unknown as Partial<GranularPermissions>),
    };
  }
  return base;
}

export function hasPermission(user: AdminUser | null | undefined, permission: PermissionKey): boolean {
  if (!user) return false;
  if (user.role === 'SUPER_ADMIN') return true;
  const perms = resolveUserPermissions(user);
  return Boolean(perms[permission]);
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
      return perms['production.review'] || perms['production.approve'] || perms['production.correct'];
    case 'historical-import':
    case 'bulk-entry':
      return perms['excel.import'];
    case 'raw-materials':
    case 'material-traceability':
      return perms['materials.view'];
    case 'master-data':
      return perms['masterdata.view'] || perms['employees.view'] || perms['products.view'];
    case 'user-management':
      return perms['users.view'];
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
    case 'versions':
      return perms['system.view'];
    case 'settings':
    case 'admin-panel':
      return perms['settings.view'] || perms['audit.view'];
    case 'branding':
      return perms['settings.view'] || user?.role === 'SUPER_ADMIN' || user?.role === 'ADMIN';
    default:
      return true;
  }
}

export const ALL_PERMISSION_KEYS: PermissionKey[] = Object.keys(DEFAULT_SUPER_ADMIN_PERMISSIONS) as PermissionKey[];

export function countActivePermissions(permissions: GranularPermissions | undefined | null): number {
  if (!permissions) return 0;
  let count = 0;
  Object.entries(permissions).forEach(([key, val]) => {
    if (key !== 'production.scope' && val === true) {
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
    id: 'production',
    nameAr: 'عمليات وسجلات الإنتاج',
    nameEn: 'Production Operations',
    icon: 'Layers',
    permissions: [
      { key: 'production.view', nameAr: 'عرض سجلات الإنتاج', nameEn: 'View Production Records', descriptionAr: 'السماح باستعراض سجلات الإنتاج', descriptionEn: 'Allow viewing production records' },
      { key: 'production.create', nameAr: 'تسجيل عملية إنتاج جديدة', nameEn: 'Create Production Record', descriptionAr: 'إدخال سجلات الإنتاج الميدانية للورديات', descriptionEn: 'Enter shift production records' },
      { key: 'production.edit', nameAr: 'تعديل سجلات الإنتاج', nameEn: 'Edit Production Records', descriptionAr: 'تعديل البيانات والأوزان والأعطال', descriptionEn: 'Modify quantities, weights, and faults' },
      { key: 'production.delete', nameAr: 'حذف سجلات الإنتاج', nameEn: 'Delete Production Records', descriptionAr: 'صلاحية حذف السجلات نهائياً', descriptionEn: 'Permanently remove records' },
      { key: 'production.submit', nameAr: 'تقديم السجل للمراجعة (Submit)', nameEn: 'Submit for Review', descriptionAr: 'إرسال السجل من حالة مسودة إلى قيد المراجعة', descriptionEn: 'Send record from draft to review' },
      { key: 'production.review', nameAr: 'مراجعة وتدقيق السجلات', nameEn: 'Review Records', descriptionAr: 'فحص جودة السجلات ومطابقة الأرقام', descriptionEn: 'Examine record quality and numbers' },
      { key: 'production.approve', nameAr: 'اعتماد السجلات رسمياً (Approve)', nameEn: 'Approve Records', descriptionAr: 'إقرار السجل كإنتاج معتمد نهائي', descriptionEn: 'Approve record as officially verified' },
      { key: 'production.reject', nameAr: 'رفض السجلات (Reject)', nameEn: 'Reject Records', descriptionAr: 'رفض السجل مع توضيح السبب', descriptionEn: 'Reject record with reason note' },
      { key: 'production.correct', nameAr: 'تصحيح السجلات المعتمدة (Correct)', nameEn: 'Correct Records', descriptionAr: 'إجراء تصحيح تدقيقي مع حفظ السجل القديم', descriptionEn: 'Perform audit correction preserving history' },
    ],
  },
  {
    id: 'stages',
    nameAr: 'مراحل الإنتاج الثمانية',
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
      { key: 'stage.sorting', nameAr: 'مرحلة 8: الفرز والمراقبة', nameEn: 'Stage 8: Sorting & Quality Inspection', descriptionAr: 'تسجيل وتدقيق عيوب الفرز والشطف والشروخ', descriptionEn: 'Defect inspection & sorting' },
    ],
  },
  {
    id: 'masterdata',
    nameAr: 'البيانات الأساسية للمصنع',
    nameEn: 'Master Data Management',
    icon: 'Database',
    permissions: [
      { key: 'masterdata.view', nameAr: 'عرض شاشات البيانات الأساسية', nameEn: 'View Master Data', descriptionAr: 'الاطلاع على القوائم الأساسية', descriptionEn: 'View master data lists' },
      { key: 'employees.view', nameAr: 'عرض سجلات العمال والمشغلين', nameEn: 'View Employees', descriptionAr: 'استعراض بيانات العمال وأكوادهم', descriptionEn: 'View employee directory' },
      { key: 'employees.create', nameAr: 'إضافة عامل جديد', nameEn: 'Add Employee', descriptionAr: 'تسجيل كود واسم عامل جديد', descriptionEn: 'Register new employee code & name' },
      { key: 'employees.edit', nameAr: 'تعديل بيانات العامل', nameEn: 'Edit Employee', descriptionAr: 'تعديل الاسم أو القسم أو الحالة', descriptionEn: 'Update employee details' },
      { key: 'employees.delete', nameAr: 'حذف سجل العامل', nameEn: 'Delete Employee', descriptionAr: 'إلغاء أو حذف بيانات العامل', descriptionEn: 'Remove employee record' },
      { key: 'products.view', nameAr: 'عرض كتالوج المنتجات والأصناف', nameEn: 'View Products Catalog', descriptionAr: 'الاطلاع على أصناف الطوب والحراريات', descriptionEn: 'View refractory products catalog' },
      { key: 'products.create', nameAr: 'إضافة منتج وكود جديد', nameEn: 'Add New Product', descriptionAr: 'إنشاء كود منتج وأوزان قطع', descriptionEn: 'Create product code and piece weights' },
      { key: 'products.edit', nameAr: 'تعديل المنتجات وأوزان القطع', nameEn: 'Edit Product & Piece Weight', descriptionAr: 'تعديل نسبة الألومينا والأوزان بالكيلوجرام', descriptionEn: 'Edit alumina % and kg piece weight' },
      { key: 'products.delete', nameAr: 'حذف منتج', nameEn: 'Delete Product', descriptionAr: 'حذف المنتج من الكتالوج', descriptionEn: 'Remove product from catalog' },
      { key: 'customers.view', nameAr: 'عرض بيانات العملاء والشركات', nameEn: 'View Customers', descriptionAr: 'الاطلاع على قائمة العملاء والطلبيات', descriptionEn: 'View customers list' },
      { key: 'customers.create', nameAr: 'إضافة عميل جديد', nameEn: 'Add Customer', descriptionAr: 'تسجيل شركة أو عميل جديد', descriptionEn: 'Register new customer' },
      { key: 'customers.edit', nameAr: 'تعديل بيانات العميل', nameEn: 'Edit Customer', descriptionAr: 'تحديث بيانات التواصل أو الكود', descriptionEn: 'Update customer details' },
      { key: 'customers.delete', nameAr: 'حذف عميل', nameEn: 'Delete Customer', descriptionAr: 'حذف العميل من القائمة', descriptionEn: 'Remove customer' },
      { key: 'presses.view', nameAr: 'عرض المكابس ومعدات التشكيل', nameEn: 'View Presses', descriptionAr: 'استعراض المكابس وطاقاتها', descriptionEn: 'View presses and capacities' },
      { key: 'presses.edit', nameAr: 'تعديل بيانات المكابس', nameEn: 'Edit Presses', descriptionAr: 'تحديث حالة وضغط المكبس', descriptionEn: 'Update press status & tonnage' },
      { key: 'furnaces.view', nameAr: 'عرض الأفران وعربات الأفران', nameEn: 'View Furnaces & Cars', descriptionAr: 'استعراض الأفران وأرقام العربات', descriptionEn: 'View furnaces and car numbers' },
      { key: 'furnaces.edit', nameAr: 'تعديل بيانات الأفران والعربات', nameEn: 'Edit Furnaces & Cars', descriptionAr: 'تعديل سعة الفرن والعربات', descriptionEn: 'Update furnace & car capacities' },
      { key: 'materials.view', nameAr: 'عرض الخامات والمواد الأولية والمخزون', nameEn: 'View Raw Materials & Stock', descriptionAr: 'الاطلاع على أرصدة الخامات والشاموت', descriptionEn: 'View raw materials & chamotte stock' },
      { key: 'materials.create', nameAr: 'إضافة خامة جديدة', nameEn: 'Add Raw Material', descriptionAr: 'تسجيل خامة جديدة ووحدة قياس', descriptionEn: 'Register new material & unit' },
      { key: 'materials.edit', nameAr: 'تعديل الخامات والمخزون', nameEn: 'Edit Material & Stock', descriptionAr: 'تحديث أرصدة الخامات وتكاليفها', descriptionEn: 'Update stock levels & costs' },
    ],
  },
  {
    id: 'reports_excel',
    nameAr: 'التقارير واستيراد وتصدير الإكسل',
    nameEn: 'Reports & Excel Operations',
    icon: 'FileSpreadsheet',
    permissions: [
      { key: 'reports.view', nameAr: 'عرض شاشة التقارير التحليلية', nameEn: 'View Analytical Reports', descriptionAr: 'الاطلاع على تقارير الإنتاج والهالك والأطنان', descriptionEn: 'View production, waste, and ton reports' },
      { key: 'reports.export', nameAr: 'تصدير التقارير إلى Excel و PDF', nameEn: 'Export Reports (Excel/PDF)', descriptionAr: 'تنزيل التقارير مع حسابات الأطنان', descriptionEn: 'Download reports with ton calculations' },
      { key: 'reports.custom_queries', nameAr: 'الاستعلامات والفلترة المتقدمة متعددة الأبعاد', nameEn: 'Advanced Multi-Dimension Queries', descriptionAr: 'تصفية التقارير حسب المكبس والعامل والتاريخ والفرن', descriptionEn: 'Filter by press, worker, date, and furnace' },
      { key: 'excel.import', nameAr: 'استيراد سجلات الإنتاج التاريخية من Excel', nameEn: 'Import Historical Excel Records', descriptionAr: 'رفع شيتات إكسل مع التحقق والمطابقة الذكية', descriptionEn: 'Upload excel sheets with smart matching' },
      { key: 'excel.export', nameAr: 'تصدير جداول البيانات إلى Excel', nameEn: 'Export Data Tables to Excel', descriptionAr: 'تصدير أي جدول أو قائمة بصيغة XLSX', descriptionEn: 'Export tables to XLSX' },
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
    nameAr: 'إدارة المستخدمين والمشغلين والصلاحيات',
    nameEn: 'User & Permission Management',
    icon: 'Users',
    permissions: [
      { key: 'users.view', nameAr: 'عرض قائمة المستخدمين والحسابات', nameEn: 'View User Directory', descriptionAr: 'استعراض الحسابات المسجلة والأدوار', descriptionEn: 'View registered users & roles' },
      { key: 'users.create', nameAr: 'إنشاء حساب مستخدم جديد (Firebase Auth)', nameEn: 'Create System User', descriptionAr: 'إنشاء بريد وكلمة مرور وتحديد الدور', descriptionEn: 'Create email, password, and assign role' },
      { key: 'users.edit', nameAr: 'تعديل بيانات المستخدم وربط كود العامل', nameEn: 'Edit User & Link Employee Code', descriptionAr: 'تحديث بيانات المستخدم وربطه بعامل مصنع', descriptionEn: 'Update user profile & link to employee' },
      { key: 'users.activate', nameAr: 'تفعيل حساب المستخدم', nameEn: 'Activate User', descriptionAr: 'السماح للمستخدم بالدخول للنظام', descriptionEn: 'Allow user system access' },
      { key: 'users.deactivate', nameAr: 'تعطيل حساب المستخدم', nameEn: 'Deactivate User', descriptionAr: 'إيقاف الدخول مؤقتاً دون حذف البيانات', descriptionEn: 'Temporarily suspend access' },
      { key: 'users.reset_password', nameAr: 'إعادة تعيين كلمة المرور', nameEn: 'Reset User Password', descriptionAr: 'إرسال رابط استعادة أو تحديث كلمة المرور', descriptionEn: 'Send password reset link' },
      { key: 'users.change_role', nameAr: 'تغيير الدور الوظيفي للمستخدم', nameEn: 'Change User Role', descriptionAr: 'الترقية أو التعيين لأدوار مختلفة', descriptionEn: 'Promote or reassign roles' },
      { key: 'users.manage_permissions', nameAr: 'تخصيص الصلاحيات التفصيلية الدقيقة (Granular)', nameEn: 'Customize Granular Permissions', descriptionAr: 'تحديد مربعات الاختيار الفردية لكل مستخدم', descriptionEn: 'Toggle individual permission checkboxes' },
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
    nameAr: 'إدارة النظام وصحة الاتصال السحابي',
    nameEn: 'System Health & Administration',
    icon: 'ShieldCheck',
    permissions: [
      { key: 'system.view', nameAr: 'عرض صحة النظام وزمن استجابة Firestore', nameEn: 'View System Health & Latency', descriptionAr: 'مراقبة اتصال قاعدة البيانات وحالة الجلسات', descriptionEn: 'Monitor database connection & latency' },
      { key: 'system.manage', nameAr: 'إدارة إعدادات النظام المتقدمة', nameEn: 'Manage System Settings', descriptionAr: 'التحكم بالبروتوكولات ونسخ المخطط (Schema)', descriptionEn: 'Manage protocols & schema version' },
      { key: 'audit.view', nameAr: 'عرض سجل التدقيق والأنشطة الأمنية (Audit Logs)', nameEn: 'View Security Audit Logs', descriptionAr: 'متابعة سجل حركات الدخول والتعديلات والحذف', descriptionEn: 'Review login, update, and delete audit trails' },
      { key: 'settings.view', nameAr: 'عرض شاشة الإعدادات', nameEn: 'View Settings Page', descriptionAr: 'الاطلاع على بيانات المنظومة والنسخ', descriptionEn: 'View system configuration' },
      { key: 'settings.edit', nameAr: 'تعديل إعدادات النظام', nameEn: 'Edit System Settings', descriptionAr: 'تحديث تفضيلات المنظومة', descriptionEn: 'Update system preferences' },
    ],
  },
];

export const PERMISSION_CATEGORIES = PERMISSION_CATEGORY_GROUPS;


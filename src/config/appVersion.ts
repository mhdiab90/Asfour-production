export interface AppVersionInfo {
  version: string;
  buildId: string;
  buildTimestamp: string;
  gitCommit: string;
  deploymentId: string;
  databaseSchemaVersion: number;
  environment: 'production' | 'staging' | 'development';
  releaseDate: string;
  changelog: {
    version: string;
    date: string;
    highlights: string[];
  }[];
}

export const CURRENT_APP_VERSION: AppVersionInfo = {
  version: '3.2.0',
  buildId: '2026-08-22-001',
  buildTimestamp: '2026-08-22T08:45:00Z',
  gitCommit: 'main-v3.2.0',
  deploymentId: 'asfour-prod-20260822',
  databaseSchemaVersion: 3,
  environment: 'production',
  releaseDate: '2026-08-22',
  changelog: [
    {
      version: '3.2.0',
      date: '2026-08-22',
      highlights: [
        'منظومة المراحل الصناعية الثمانية الكاملة (8 Independent Production Stages)',
        'مركز النسخ الاحتياطي الشامل والاستعادة الآمنة (Full Backup & Safe Restore Center)',
        'محرك التحديث التلقائي وكشف الإصدارات الجديدة (Auto-Update & Version Detection)',
        'مركز مراجعة واعتماد السجلات وسجل التدقيق التاريخي (Data Review & Audit Trail)',
        'استيراد الإنتاج التاريخي وقوالب الإكسل المتقدمة وتتبع الخامات'
      ]
    },
    {
      version: '3.1.0',
      date: '2026-08-15',
      highlights: [
        'نظام الدخول الموحد باسم المستخدم وكود العامل المجرد',
        'محدد الكيانات الذكي الشامل والإضافة الفورية (Inline Add)',
        'التعامل الذكي مع أكواد المنتجات والأرقام اليدوية'
      ]
    },
    {
      version: '3.0.0',
      date: '2026-08-01',
      highlights: [
        'النشر السحابي على Cloudflare Pages مع قاعدة بيانات Firebase Firestore',
        'تطبيق الويب التقدمي (PWA) ودعم العمل على الهواتف والأجهزة اللوحية'
      ]
    }
  ]
};

export const DATABASE_SCHEMA_VERSION = CURRENT_APP_VERSION.databaseSchemaVersion;
export const APP_VERSION = CURRENT_APP_VERSION.version;
export const BUILD_ID = CURRENT_APP_VERSION.buildId;

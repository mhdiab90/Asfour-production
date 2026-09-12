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

/**
 * Build identity injected by vite.config.ts's build-identity plugin, which
 * derives every one of these from Git at build time. The `?? ` fallbacks only
 * apply when this module is loaded outside a Vite build (a plain tsx/node test
 * run), never in a shipped bundle.
 *
 * These used to be hand-edited literals and had drifted badly: production ran
 * commit 454291d while declaring buildId '2026-08-22-001' and a gitCommit of
 * 'main-v3.2.0' - a branch label, not a SHA. Nothing here is hand-maintained
 * any more EXCEPT `version`, which stays a deliberate product decision below.
 */
declare const __BUILD_ID__: string | undefined;
declare const __BUILD_COMMIT_SHA__: string | undefined;
declare const __BUILD_TIMESTAMP__: string | undefined;
declare const __BUILD_DEPLOYMENT_ID__: string | undefined;

const BUILD_ID_INJECTED = typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : 'dev';
const COMMIT_SHA_INJECTED = typeof __BUILD_COMMIT_SHA__ === 'string' ? __BUILD_COMMIT_SHA__ : '';
const BUILD_TIMESTAMP_INJECTED = typeof __BUILD_TIMESTAMP__ === 'string' ? __BUILD_TIMESTAMP__ : '';
const DEPLOYMENT_ID_INJECTED = typeof __BUILD_DEPLOYMENT_ID__ === 'string' ? __BUILD_DEPLOYMENT_ID__ : 'dev';

export const CURRENT_APP_VERSION: AppVersionInfo = {
  /** Set by the automatic release planner from the classified change set - see releasePlannerPure.ts. */
  version: '3.11.0',
  buildId: BUILD_ID_INJECTED,
  buildTimestamp: BUILD_TIMESTAMP_INJECTED,
  gitCommit: COMMIT_SHA_INJECTED,
  deploymentId: DEPLOYMENT_ID_INJECTED,
  databaseSchemaVersion: 3,
  environment: 'production',
  releaseDate: '2026-08-22',
  changelog: [
    {
      version: '3.11.0',
      date: '2026-09-12',
      highlights: [
        'تقارير تفهم التسلسل الهرمي: اختيار مركز إنتاجي يشمل كل المراكز التابعة',
        'نطاق التقرير يعمل مع فلاتر التاريخ والمرحلة والمنتج والعميل والوردية معًا',
        'عدم تكرار احتساب أي سجل عند اختيار أكثر من فرع متداخل',
        'التقرير بدون اختيار تسلسل يعمل تمامًا كما كان دون أي تغيير'
      ]
    },
    {
      version: '3.10.0',
      date: '2026-09-12',
      highlights: [
        'ربط المكابس والأفران بعقد التسلسل الهرمي لمراكز التكلفة من البيانات الأساسية',
        'اختيار عقدة أب في تصفية الإنتاج يشمل كل المعدات التابعة تلقائيًا',
        'بيان حالة الربط وعدد المعدات غير المرتبطة في البيانات الأساسية',
        'لم يتم تعديل أي سجل إنتاج تاريخي - الربط يتم عبر البيانات الأساسية فقط'
      ]
    },
    {
      version: '3.9.0',
      date: '2026-09-12',
      highlights: [
        'تصفية سجلات الإنتاج حسب نوع الأكواد ثم الأكواد بدلاً من المكبس فقط',
        'المراكز الإنتاجية تشمل المكابس والأفران معًا، مع العملاء والورديات والمنتجات',
        'كود واحد أو عدة أكواد أو كل الأكواد، وقائمة الأكواد مصدرها البيانات الأساسية',
        'الحسابات المالية ومراكز التكلفة تبقى بيانات أساسية فقط لعدم وجود ارتباط فعلي بسجلات الإنتاج'
      ]
    },
    {
      version: '3.8.0',
      date: '2026-09-12',
      highlights: [
        'تحديد صفوف سجلات الإنتاج: مربع اختيار لكل سجل وفي رأس الجدول',
        'تحديد الكل الظاهر وإلغاء تحديد الكل مع عداد للسجلات المحددة',
        'إلغاء تحديد السجلات المخفية تلقائيًا عند تغيير الفلاتر',
        'التحديد لا يغيّر أي بيانات ولا يوجد حذف جماعي'
      ]
    },
    {
      version: '3.7.0',
      date: '2026-09-12',
      highlights: [
        'استيراد الحسابات المالية أصبح له شاشة مخصصة داخل البيانات الأساسية',
        'لم يعد الاستيراد ينتقل إلى شاشة استيراد البيانات التاريخية',
        'اختيار ورقة العمل ومعاينة الصفوف والتحقق من الحساب الأصل قبل الاستيراد',
        'استيراد جزئي: الصفوف الصالحة تُستورد ولا تتعطل بسبب صف خاطئ'
      ]
    },
    {
      version: '3.6.0',
      date: '2026-09-10',
      highlights: [
        'تنظيم البيانات الأساسية حسب التصنيف أولاً مع سجل تصنيفات قابل للتوسعة',
        'الحسابات المالية: استيراد من Excel وتحرير وبحث وتسلسل هرمي كامل',
        'محرك تسلسل هرمي موحّد: اختيار الأصل يشمل كل الفروع التابعة مهما كان عمقها',
        'تحرير مراكز التكلفة الهرمية مع منع الحلقات المغلقة والأصل غير الموجود',
        'تجميع الإنتاج حسب التسلسل الهرمي دون تكرار احتساب أي سجل'
      ]
    },
    {
      version: '3.5.0',
      date: '2026-09-10',
      highlights: [
        'تنظيم البيانات الأساسية حسب التصنيف أولاً ثم الأكواد',
        'تصفية مراجعة الإنتاج حسب التصنيف والأكواد مع تحديد واحد أو متعدد أو الكل',
        'تحديد الصفوف والتعديل الجماعي مع عزل الأخطاء لكل صف',
        'إظهار مراكز التكلفة الهرمية المستوردة في البيانات الأساسية'
      ]
    },
    {
      version: '3.4.0',
      date: '2026-09-10',
      highlights: [
        'تخطيط إصدارات تلقائي: تصنيف التغيير من الفروق الفعلية واشتقاق نوع التغيير ورقم الإصدار تلقائيًا',
        'توليد تلقائي لأكواد التغيير ومعرّف الإطلاق دون إدخال يدوي',
        'بوابة الإصدار تتحقق من تطابق رقم الإصدار مع التصنيف الفعلي'
      ]
    },
    {
      version: '3.3.0',
      date: '2026-09-10',
      highlights: [
        'إدارة إصدارات النظام وسجل الإطلاقات وسجل التغييرات (Version Management & Change Registry)',
        'أكواد تغيير محدودة وثابتة لكل تعديل مع نطاقه الكامل (Bounded, immutable Change IDs)',
        'ربط الإصدار بالإطلاق وكود الالتزام والبناء والنشر (Version -> Release -> Commit -> Build -> Deployment)',
        'بوابة إصدار إلزامية تمنع النشر من شجرة عمل غير نظيفة (Mandatory release gate)'
      ]
    },
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

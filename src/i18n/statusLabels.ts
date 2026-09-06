/**
 * Central enum/status label map (§6 of the localization task) - "Do NOT
 * render raw enum names to users." Every internal status code the app
 * stores (RowCategory, RecordStatus, import outcome, active/inactive, etc.)
 * gets ONE bilingual label here, so a raw string like "BLOCKING" or
 * "READY_TO_IMPORT" is never shown to a user in either language.
 */
import { Language } from './types';

const STATUS_LABELS: Record<string, { ar: string; en: string }> = {
  VALID: { ar: 'صالح', en: 'Valid' },
  WARNING: { ar: 'تنبيه', en: 'Warning' },
  BLOCKING: { ar: 'خطأ مانع', en: 'Blocking' },
  CORRECTED: { ar: 'تم التصحيح', en: 'Corrected' },
  APPROVED: { ar: 'معتمد', en: 'Approved' },
  SKIPPED: { ar: 'تم التخطي', en: 'Skipped' },
  EXCLUDED: { ar: 'مستبعد', en: 'Excluded' },
  INCLUDED: { ar: 'مضمّن', en: 'Included' },
  READY: { ar: 'جاهز', en: 'Ready' },
  READY_TO_IMPORT: { ar: 'جاهز للاستيراد', en: 'Ready to Import' },
  IMPORTED: { ar: 'تم الاستيراد', en: 'Imported' },
  FAILED: { ar: 'فشل', en: 'Failed' },
  ACTIVE: { ar: 'نشط', en: 'Active' },
  INACTIVE: { ar: 'غير نشط', en: 'Inactive' },
  ARCHIVED: { ar: 'مؤرشف', en: 'Archived' },
  PENDING: { ar: 'قيد الانتظار', en: 'Pending' },
  DRAFT: { ar: 'مسودة', en: 'Draft' },
  SUBMITTED: { ar: 'تم الإرسال', en: 'Submitted' },
  REVIEWED: { ar: 'تمت المراجعة', en: 'Reviewed' },
  REJECTED: { ar: 'مرفوض', en: 'Rejected' },
  // Translation Manager / Language Audit quality statuses
  DEFAULT: { ar: 'افتراضي', en: 'Default' },
  CUSTOM: { ar: 'مخصص', en: 'Custom' },
  REVIEW_REQUIRED: { ar: 'يتطلب مراجعة', en: 'Review Required' },
  MISSING: { ar: 'مفقود', en: 'Missing' },
};

export function getStatusLabel(status: string | undefined | null, language: Language): string {
  if (!status) return '';
  const entry = STATUS_LABELS[status];
  if (!entry) return status;
  return language === 'ar' ? entry.ar : entry.en;
}

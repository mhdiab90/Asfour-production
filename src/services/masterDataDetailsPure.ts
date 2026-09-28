/**
 * Master Data record details - what a double-click on a row shows (3.23.0).
 *
 * A double-click on a code opens it in full: every field the record carries,
 * with a readable label where one is known, in a stable order (identity first,
 * then the rest alphabetically, bookkeeping last). A BOM or a routing opens its
 * own versions window with the version that matters - the ACTIVE one, else the
 * newest - already open, so its components or steps are on screen at once.
 *
 * Pure: it shapes what is already loaded. It reads nothing and writes nothing,
 * and it hides nothing a user could need - only the search-index copies
 * (`...Normalized`), which repeat a visible field in lower case.
 */

/** One labelled value of the details view. */
export interface DetailField {
  key: string;
  labelAr: string;
  labelEn: string;
  value: string;
  /** Long or structured values (lists, objects) are shown as a block, not inline. */
  block: boolean;
}

/** Readable labels for the fields Master Data records commonly carry. */
export const DETAIL_FIELD_LABELS: Record<string, { ar: string; en: string }> = {
  code: { ar: 'الكود', en: 'Code' },
  productCode: { ar: 'كود المنتج', en: 'Product code' },
  name: { ar: 'الاسم', en: 'Name' },
  nameAr: { ar: 'الاسم بالعربية', en: 'Arabic name' },
  nameEn: { ar: 'الاسم بالإنجليزية', en: 'English name' },
  category: { ar: 'التصنيف', en: 'Category' },
  description: { ar: 'الوصف', en: 'Description' },
  unit: { ar: 'الوحدة', en: 'Unit' },
  uom: { ar: 'وحدة القياس', en: 'Unit of measure' },
  dimensions: { ar: 'الأبعاد', en: 'Dimensions' },
  pieceWeight: { ar: 'وزن القطعة', en: 'Piece weight' },
  pieceWeightKg: { ar: 'وزن القطعة (كجم)', en: 'Piece weight (kg)' },
  aluminaPercentage: { ar: 'نسبة الألومينا %', en: 'Alumina %' },
  productTypePrefix: { ar: 'البادئة', en: 'Prefix' },
  productTypeName: { ar: 'نوع المنتج', en: 'Product type' },
  productTypeNameAr: { ar: 'نوع المنتج (عربي)', en: 'Product type (Arabic)' },
  productIdentifier: { ar: 'معرف المنتج', en: 'Product identifier' },
  prefixCode: { ar: 'البادئة', en: 'Prefix code' },
  itemKind: { ar: 'نوع الصنف', en: 'Item kind' },
  itemSource: { ar: 'مصدر الصنف', en: 'Item source' },
  itemId: { ar: 'الصنف', en: 'Item' },
  customerId: { ar: 'العميل', en: 'Customer' },
  logicalItemId: { ar: 'الصنف المنطقي', en: 'Logical item' },
  isDefault: { ar: 'افتراضي', en: 'Default' },
  jobTitle: { ar: 'الوظيفة', en: 'Job title' },
  departmentName: { ar: 'القسم', en: 'Department' },
  company: { ar: 'الشركة', en: 'Company' },
  phone: { ar: 'الهاتف', en: 'Phone' },
  email: { ar: 'البريد الإلكتروني', en: 'Email' },
  address: { ar: 'العنوان', en: 'Address' },
  accountType: { ar: 'نوع الحساب', en: 'Account type' },
  parentCode: { ar: 'الكود الأب', en: 'Parent code' },
  sheet1Code: { ar: 'الكود', en: 'Code' },
  hierarchyNodeId: { ar: 'عقدة التسلسل الهرمي', en: 'Hierarchy node' },
  externalRefs: { ar: 'المراجع الخارجية', en: 'External references' },
  origin: { ar: 'محلي / مستورد', en: 'Local / Imported' },
  lastPurchasePrice: { ar: 'آخر سعر شراء', en: 'Last purchase price' },
  averageIssuePrice: { ar: 'متوسط سعر المنصرف', en: 'Average issue price' },
  priceUnit: { ar: 'السعر لكل', en: 'Price per' },
  pricesUpdatedAt: { ar: 'آخر تحديث للأسعار', en: 'Prices updated' },
  notes: { ar: 'ملاحظات', en: 'Notes' },
  active: { ar: 'نشط', en: 'Active' },
  status: { ar: 'الحالة', en: 'Status' },
  createdAt: { ar: 'تاريخ الإنشاء', en: 'Created' },
  updatedAt: { ar: 'آخر تعديل', en: 'Updated' },
  createdBy: { ar: 'أنشأه', en: 'Created by' },
  updatedBy: { ar: 'عدّله', en: 'Updated by' },
  id: { ar: 'المعرف الداخلي', en: 'Internal id' },
};

/** Shown first, in this order, when present. */
const LEADING_FIELDS = ['code', 'productCode', 'sheet1Code', 'prefixCode', 'name', 'nameAr', 'nameEn'];
/** Shown last, in this order, when present. */
const TRAILING_FIELDS = ['active', 'status', 'createdAt', 'createdBy', 'updatedAt', 'updatedBy', 'id'];

/** Search-index copies of visible fields - hidden, they only repeat another field. */
export function isSearchIndexField(key: string): boolean {
  return /Normalized$/.test(key);
}

/** A Firestore timestamp as stored or as read ({seconds} / toDate()), or an ISO string. */
function asDate(value: unknown): Date | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as { toDate?: () => Date; seconds?: unknown };
  if (typeof v.toDate === 'function') {
    const d = v.toDate();
    return d instanceof Date && !Number.isNaN(d.getTime()) ? d : null;
  }
  if (typeof v.seconds === 'number') return new Date(v.seconds * 1000);
  return null;
}

/** YYYY-MM-DD HH:MM in the viewer's own time zone - the time they would read on a clock. */
export function localDateTime(date: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())} ${p(date.getHours())}:${p(date.getMinutes())}`;
}

/** One value as text: yes / no, dates as YYYY-MM-DD HH:MM, lists and objects as readable JSON. */
export function formatDetailValue(value: unknown, language: 'ar' | 'en'): { text: string; block: boolean } {
  if (value === null || value === undefined || value === '') return { text: '-', block: false };
  if (typeof value === 'boolean') return { text: value ? (language === 'ar' ? 'نعم' : 'Yes') : (language === 'ar' ? 'لا' : 'No'), block: false };
  if (typeof value === 'number') return { text: Number.isFinite(value) ? value.toLocaleString('en-US', { maximumFractionDigits: 6 }) : String(value), block: false };
  if (typeof value === 'string') return { text: value, block: value.length > 120 || value.includes('\n') };
  const date = asDate(value);
  if (date) return { text: localDateTime(date), block: false };
  if (Array.isArray(value) && value.length === 0) return { text: '-', block: false };
  try {
    return { text: JSON.stringify(value, null, 2), block: true };
  } catch {
    return { text: String(value), block: false };
  }
}

/**
 * Every field of a record, labelled and ordered for reading.
 *
 * Identity first (code, name), then every other field alphabetically by key,
 * then status and bookkeeping. Nothing the record carries is dropped except the
 * search-index copies. `resolve` lets the caller turn an id field (a customer,
 * an item) into the label the table shows, exactly as it does in the row.
 */
export function recordDetailFields(
  record: Record<string, unknown> | null | undefined,
  language: 'ar' | 'en',
  resolve?: (key: string, value: unknown) => string | null,
): DetailField[] {
  if (!record) return [];
  const keys = Object.keys(record).filter((k) => !isSearchIndexField(k) && !k.startsWith('__'));
  const leading = LEADING_FIELDS.filter((k) => keys.includes(k));
  const trailing = TRAILING_FIELDS.filter((k) => keys.includes(k));
  const middle = keys.filter((k) => !leading.includes(k) && !trailing.includes(k)).sort((a, b) => a.localeCompare(b));
  return [...leading, ...middle, ...trailing].map((key) => {
    const raw = record[key];
    const resolved = resolve ? resolve(key, raw) : null;
    const formatted = resolved !== null && resolved !== undefined && resolved !== ''
      ? { text: resolved, block: false }
      : formatDetailValue(raw, language);
    const label = DETAIL_FIELD_LABELS[key];
    return {
      key,
      labelAr: label?.ar ?? key,
      labelEn: label?.en ?? key,
      value: formatted.text,
      block: formatted.block,
    };
  });
}

/**
 * The version a double-click opens: the ACTIVE one (the newest, if history
 * somehow holds two), else the newest version of any status, else none.
 * `versions` may be in any order; newest is by createdAt.
 */
export function versionToShowFirst<T extends object>(versions: readonly T[]): T | null {
  if (versions.length === 0) return null;
  const field = (v: T, key: string): unknown => (v as Record<string, unknown>)[key];
  const newestFirst = [...versions].sort((a, b) => String(field(b, 'createdAt') ?? '').localeCompare(String(field(a, 'createdAt') ?? '')));
  return newestFirst.find((v) => String(field(v, 'status') ?? '').toUpperCase() === 'ACTIVE') ?? newestFirst[0];
}

/**
 * Whether a double-click on this element should open the row.
 *
 * Not when it lands on a control inside the row - a checkbox, an action button,
 * a link - so selecting or editing keeps working exactly as before.
 */
export const ROW_CONTROL_SELECTOR = 'input, button, select, textarea, a, label';

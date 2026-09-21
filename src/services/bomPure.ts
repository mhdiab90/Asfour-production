/**
 * Bill of Materials foundation - Phase 1 Step 2. Pure and Firebase-free.
 *
 * WHAT A BOM IS HERE: which items, in what quantities, make one item. Nothing
 * else. No operations, stages, cost centres, equipment, costs or production -
 * those are Routing, Actual Consumption and Costing, later steps.
 *
 * TWO COLLECTIONS.
 *   boms         the logical BOM of one item: business `code` (unique among
 *                BOMs, the existing Master Data rule), `name`, the item it makes,
 *                an optional customer (a customer-specific variant; none = the
 *                standard BOM), `isDefault`, notes, active. Managed in the shared
 *                Master Data tab engine.
 *   bomVersions  one document per revision: `bomId`, `versionCode` (unique within
 *                its BOM), DRAFT / ACTIVE / RETIRED, optional effective dates,
 *                optional quantity basis and expected yield, notes, and its
 *                `components` array. A version's components are a bounded list
 *                saved and audited together, so they live in the version
 *                document - never inside the Product, and never as an unbounded
 *                array on the BOM.
 *
 * LIFECYCLE, minimal: DRAFT -> ACTIVE -> RETIRED (a draft may also be retired
 * unused). Components change only while DRAFT; to change an ACTIVE recipe,
 * start a new version from it. Nothing is deleted, so a version production may
 * later point at stays readable exactly as it was. One ACTIVE version per BOM;
 * activating a second is refused with the conflict named, never resolved by
 * retiring the other automatically. The same explicit rule applies to defaults:
 * at most one active default BOM per (item, customer) scope.
 *
 * ITEM REFERENCES. A BOM's item and every component are (itemSource, itemId):
 * the collection ('products' or 'materials') plus that record's document id.
 * Never a code, a name or an external id. Both collections are allowed because
 * a component may be a raw material, a calcined intermediate kept as a product,
 * or a finished product. The stored reference stays the record (Phase 1 Step
 * 2A decision): no identity is created implicitly for a BOM. Wherever two
 * references could be the same item, they are compared by LOGICAL identity -
 * `resolveLogicalItemId` (logicalItemPure.ts) turns a product and a material
 * that a user mapped as one logical item into the same key. So a version can
 * never list the product AND the material of one logical item, a BOM can never
 * contain its own item under the other collection, and default scopes are per
 * logical item. Costing later reads components through the same resolver.
 *
 * QUANTITY AND UNIT. Every component has an explicit quantity (> 0) and unit,
 * chosen from the unit values the app already stores (see BOM_UNITS). Nothing
 * is converted. A version MAY declare a basis ("these quantities make 1000 كجم")
 * and components MAY carry a percentage; percentages are checked against the
 * basis only when the component uses the basis unit - never assumed per 100 kg
 * or per ton.
 *
 * LEGACY MIXTURES. Product.isMixtureBOM + mixtureComponents (Tube/Ball Mills
 * historical import) are read here for display only, never written, converted
 * or treated as a version.
 */
import { LogicalItemRecord, resolveLogicalItemId } from './logicalItemPure';
import {
  SETUP_VERSION_STATUSES,
  effectiveDateIssues,
  findOtherActiveVersion,
  isVersionEditable,
  lineIdentityIssues,
  moveLine,
  nextLineId,
  normaliseSequences,
  otherActiveVersionIssue,
  versionTransitionIssue,
} from './versionedSetupPure';

// The lifecycle, date and line rules are shared with Routing (versionedSetupPure.ts);
// re-exported under the names BOM callers already use.
export { isVersionEditable, nextLineId, normaliseSequences };
export const moveComponent = moveLine;

/** Firestore collection of BOM versions (the BOM headers are MASTER_DATA_COLLECTIONS.boms). */
export const BOM_VERSION_COLLECTION = 'bomVersions';

export const BOM_VERSION_STATUSES = SETUP_VERSION_STATUSES;
export type BomVersionStatusValue = (typeof BOM_VERSION_STATUSES)[number];

/** Where an item lives - the existing item collections. */
export const BOM_ITEM_SOURCES = ['products', 'materials'] as const;
export type BomItemSourceValue = (typeof BOM_ITEM_SOURCES)[number];

/**
 * Units a BOM line may use: exactly the values already stored on materials
 * (RawMaterialsView's unit options) plus the products' piece unit. Stored as
 * the same Arabic values, so a BOM line and its item speak the same unit.
 *
 * "m²" (square metre) and "متر" (metre) were approved as real ASFOUR units for
 * the master data package. They are units like any other here - they have NO
 * conversion to mass or volume, and none is ever invented for them.
 */
export const BOM_UNITS = ['طن', 'كجم', 'م3', 'لتر', 'شكارة', 'قطعة', 'm²', 'متر'] as const;

/**
 * Legacy SPELLINGS of an approved unit value (Phase 1 Step 7A) - the same unit
 * written differently, never a conversion: no factor, exact whole-value match
 * only. The approved bag spelling is "شكارة"; the universal stage-record read
 * still labels Chinese Mills output "شيكارة".
 */
export const UNIT_SPELLING_ALIASES: Readonly<Record<string, string>> = {
  'شيكارة': 'شكارة',
  // The same square metre written without the superscript - a spelling, never a conversion.
  'm2': 'm²',
  'M2': 'm²',
};

/** The approved spelling of a unit value; any other value is returned trimmed and unchanged. */
export function approvedUnitSpelling(unit: unknown): string {
  const u = text(unit);
  return UNIT_SPELLING_ALIASES[u] ?? u;
}

export const BOM_UNIT_LABELS: Record<string, { ar: string; en: string }> = {
  'طن': { ar: 'طن', en: 'Ton' },
  'كجم': { ar: 'كجم', en: 'Kg' },
  'م3': { ar: 'متر مكعب', en: 'm³' },
  'لتر': { ar: 'لتر', en: 'Litre' },
  'شكارة': { ar: 'شكارة', en: 'Bag' },
  'قطعة': { ar: 'قطعة', en: 'Piece' },
  'm²': { ar: 'متر مربع', en: 'm²' },
  'متر': { ar: 'متر', en: 'Meter' },
};

/** Tolerance for percentage totals and basis checks (display rounding only). */
const PERCENT_TOLERANCE = 0.01;

export interface BomIssue {
  field: string;
  messageAr: string;
  messageEn: string;
}

export interface BomValidation {
  valid: boolean;
  issues: BomIssue[];
}

type Stored = Record<string, unknown> & { id?: string };

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim();
}

function optionalId(value: unknown): string | null {
  const t = text(value);
  return t === '' ? null : t;
}

/** A number from a form value, or null when empty. NaN stays NaN so validation can report it. */
function optionalNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  const n = typeof value === 'number' ? value : Number(String(value).trim());
  return n;
}

/** Same normalisation as the existing Master Data codes: trimmed, upper case, no spaces. */
function codeKey(value: unknown): string {
  return text(value).toUpperCase().replace(/\s+/g, '');
}

export interface KnownItems {
  /** Loaded ids per item source; a null or missing set means "not loaded", so nothing is refused. */
  products?: ReadonlySet<string> | null;
  materials?: ReadonlySet<string> | null;
}

function isBomItemSource(value: unknown): value is BomItemSourceValue {
  return (BOM_ITEM_SOURCES as readonly string[]).includes(text(value));
}

function itemExists(known: KnownItems | undefined, source: string, id: string): boolean {
  const set = source === 'products' ? known?.products : source === 'materials' ? known?.materials : null;
  return !set || set.has(id);
}

// --- BOM -------------------------------------------------------------------------

export function bomPayloadForSave(input: Record<string, unknown>) {
  return {
    code: text(input.code),
    name: text(input.name),
    itemSource: text(input.itemSource) || 'products',
    itemId: text(input.itemId),
    customerId: optionalId(input.customerId),
    isDefault: input.isDefault === true,
    notes: text(input.notes),
    active: input.active !== false,
  };
}

/** The default scope of a BOM: the logical item it makes plus its customer ('' = standard). */
export function bomDefaultScopeKey(bom: Record<string, unknown>, logicalItems: readonly LogicalItemRecord[] = []): string {
  const b = bomPayloadForSave(bom);
  return JSON.stringify([resolveLogicalItemId(logicalItems, b.itemSource, b.itemId), b.customerId ?? '']);
}

export interface BomContext {
  editingId?: string | null;
  knownItems?: KnownItems;
  knownCustomerIds?: ReadonlySet<string> | null;
  /** Active and inactive logical items; only ACTIVE ones join a product and a material. */
  logicalItems?: readonly LogicalItemRecord[];
}

/**
 * Validates a BOM header before the shared write.
 *
 *   code        required; unique among BOMs (retired included; an edit keeping its code is not blocked)
 *   name        required
 *   item        required (itemSource + itemId), must be a loaded record
 *   customerId  optional; must be a loaded customer when set
 *   isDefault   an ACTIVE default must be the only active default in its scope
 */
export function validateBomForSave(existing: readonly Stored[], draft: Record<string, unknown>, context: BomContext = {}): BomValidation {
  const issues: BomIssue[] = [];
  const bom = bomPayloadForSave(draft);
  const editingId = context.editingId ?? null;
  const others = existing.filter((e) => String(e.id ?? '') !== String(editingId ?? ''));

  if (!bom.code) {
    issues.push({ field: 'code', messageAr: 'كود قائمة المواد إلزامي.', messageEn: 'The BOM code is required.' });
  } else {
    const self = editingId ? existing.find((e) => String(e.id ?? '') === editingId) : undefined;
    const unchanged = self && codeKey(self.code) === codeKey(bom.code);
    if (!unchanged && others.some((e) => codeKey(e.code) === codeKey(bom.code))) {
      issues.push({ field: 'code', messageAr: `كود قائمة المواد "${bom.code}" مسجل بالفعل.`, messageEn: `BOM code "${bom.code}" already exists.` });
    }
  }
  if (!bom.name) {
    issues.push({ field: 'name', messageAr: 'اسم قائمة المواد إلزامي.', messageEn: 'The BOM name is required.' });
  }
  if (!isBomItemSource(bom.itemSource)) {
    issues.push({ field: 'itemSource', messageAr: 'مصدر الصنف غير صالح.', messageEn: 'Invalid item source.' });
  } else if (!bom.itemId) {
    issues.push({ field: 'itemId', messageAr: 'يجب اختيار الصنف الذي تُصنعه قائمة المواد.', messageEn: 'Select the item this BOM makes.' });
  } else if (!itemExists(context.knownItems, bom.itemSource, bom.itemId)) {
    issues.push({ field: 'itemId', messageAr: 'الصنف المحدد غير موجود.', messageEn: 'The selected item does not exist.' });
  }
  if (bom.customerId && context.knownCustomerIds && !context.knownCustomerIds.has(bom.customerId)) {
    issues.push({ field: 'customerId', messageAr: 'العميل المحدد غير موجود.', messageEn: 'The selected customer does not exist.' });
  }
  if (bom.isDefault && bom.active) {
    const scope = bomDefaultScopeKey(bom, context.logicalItems);
    const holder = others.find((e) => e.active !== false && e.isDefault === true && bomDefaultScopeKey(e, context.logicalItems) === scope);
    if (holder) {
      issues.push({
        field: 'isDefault',
        messageAr: `يوجد بالفعل قائمة مواد افتراضية نشطة لنفس الصنف ونفس العميل ("${text(holder.code)}"). ألغِ الافتراضي هناك أولًا.`,
        messageEn: `An active default BOM already exists for the same item and customer ("${text(holder.code)}"). Clear that default first.`,
      });
    }
  }
  return { valid: issues.length === 0, issues };
}

// --- Components -----------------------------------------------------------------------

/**
 * Formula group of a component (Phase 1 Step 7A). BASE lines make up the base
 * formula, which is 100% of the mixture; ADDITIVE lines are applied ON TOP of it
 * and never count toward that 100%. The "+" shown for an additive is display
 * only - the stored percentage is the plain number (0.5, never "+0.5").
 */
export const BOM_COMPONENT_TYPES = ['BASE', 'ADDITIVE'] as const;
export type BomComponentTypeValue = (typeof BOM_COMPONENT_TYPES)[number];

/** A line's formula group. Lines saved before Step 7A carry none and are BASE - read as such, never rewritten. */
export function componentTypeOf(line: Record<string, unknown> | null | undefined): BomComponentTypeValue {
  return text(line?.componentType).toUpperCase() === 'ADDITIVE' ? 'ADDITIVE' : 'BASE';
}

export interface BomComponentValue {
  lineId: string;
  componentType: BomComponentTypeValue;
  itemSource: string;
  itemId: string;
  /** Null only for a percentage-only line (its quantity is derived from the basis for display, never stored). */
  quantity: number;
  unit: string;
  sequence: number;
  percentage: number | null;
  notes: string;
}

export function componentPayload(input: Record<string, unknown>): BomComponentValue {
  return {
    lineId: text(input.lineId),
    componentType: componentTypeOf(input),
    itemSource: text(input.itemSource) || 'materials',
    itemId: text(input.itemId),
    quantity: optionalNumber(input.quantity) as number,
    unit: text(input.unit),
    sequence: optionalNumber(input.sequence) as number,
    percentage: optionalNumber(input.percentage),
    notes: text(input.notes),
  };
}

// --- Formula: base + additives (Phase 1 Step 7A) --------------------------------------------

const strictNumber = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);
const isValidPercentage = (value: unknown): value is number => isPositive(value) && value <= 100;

export interface FormulaLine {
  lineId: string;
  sequence: number;
  componentType: BomComponentTypeValue;
  unit: string;
  /** As stored (a positive number) or null. */
  quantity: number | null;
  percentage: number | null;
  /** Stored quantity, or basis x percentage / 100 when only the percentage is given (basis unit only). */
  effectiveQuantity: number | null;
  quantityDerived: boolean;
  /** Stored percentage, or quantity x 100 / basis when only the quantity is given in the basis unit. */
  effectivePercentage: number | null;
  percentageDerived: boolean;
}

export interface BomFormula {
  basisValid: boolean;
  basisQuantity: number | null;
  basisUnit: string | null;
  /** Percentages or additives are only meaningful against a basis. */
  basisRequired: boolean;
  /** At least one BASE line has a stored percentage: the base must then total 100%. */
  percentageBased: boolean;
  /** Every BASE line has an effective percentage. */
  baseComplete: boolean;
  additiveComplete: boolean;
  baseTotal: number;
  additiveTotal: number;
  totalApplied: number;
  lines: FormulaLine[];
}

/**
 * The formula view of a version: effective quantities and percentages per line,
 * base and additive totals. STRICT - reads stored numbers only (pass
 * bomVersionPayloadForSave(draft) for form values). Derived values are for
 * display and comparison; nothing is written back.
 */
export function bomFormula(version: Record<string, unknown>): BomFormula {
  const basisQuantity = strictNumber(version.basisQuantity);
  const basisUnit = text(version.basisUnit) || null;
  const basisValid = isPositive(basisQuantity) && basisUnit !== null && (BOM_UNITS as readonly string[]).includes(basisUnit);
  const components = Array.isArray(version.components) ? (version.components as Array<Record<string, unknown>>) : [];
  const lines: FormulaLine[] = components.map((c, i) => {
    const quantity = isPositive(c.quantity) ? c.quantity : null;
    const percentage = isValidPercentage(c.percentage) ? c.percentage : null;
    const unit = text(c.unit);
    const inBasisUnit = basisValid && unit === basisUnit;
    // Multiply before dividing (300 x 100 / 1000 = 30, not 30.000000000000004).
    const derivedQuantity = quantity === null && percentage !== null && inBasisUnit ? ((basisQuantity as number) * percentage) / 100 : null;
    const derivedPercentage = percentage === null && quantity !== null && inBasisUnit ? (quantity * 100) / (basisQuantity as number) : null;
    return {
      lineId: text(c.lineId),
      sequence: typeof c.sequence === 'number' ? c.sequence : i + 1,
      componentType: componentTypeOf(c),
      unit,
      quantity,
      percentage,
      effectiveQuantity: quantity ?? derivedQuantity,
      quantityDerived: derivedQuantity !== null,
      effectivePercentage: percentage ?? derivedPercentage,
      percentageDerived: derivedPercentage !== null,
    };
  });
  const base = lines.filter((l) => l.componentType === 'BASE');
  const additives = lines.filter((l) => l.componentType === 'ADDITIVE');
  const sum = (ls: FormulaLine[]) => ls.reduce((s, l) => s + (l.effectivePercentage ?? 0), 0);
  const baseTotal = sum(base);
  const additiveTotal = sum(additives);
  return {
    basisValid,
    basisQuantity,
    basisUnit,
    basisRequired: additives.length > 0 || lines.some((l) => l.percentage !== null),
    percentageBased: base.some((l) => l.percentage !== null),
    baseComplete: base.length > 0 && base.every((l) => l.effectivePercentage !== null),
    additiveComplete: additives.every((l) => l.effectivePercentage !== null),
    baseTotal,
    additiveTotal,
    totalApplied: baseTotal + additiveTotal,
    lines,
  };
}

/** "10%" for a base line, "+0.5%" for an additive - the "+" is display only. */
export function formatFormulaPercentage(componentType: string, percentage: number | null | undefined): string {
  if (typeof percentage !== 'number' || !Number.isFinite(percentage)) return '-';
  const shown = percentage.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 4 });
  return `${componentTypeOf({ componentType }) === 'ADDITIVE' ? '+' : ''}${shown}%`;
}

/** The one base-total message, shared by save and activation so it is never reported twice. */
function baseTotalIssue(total: number): BomIssue {
  return {
    field: 'components.percentage',
    messageAr: `إجمالي الخلطة الأساسية يجب أن يساوي 100%. (المكونات الأساسية = ${Number(total.toFixed(4))}% - الإضافات غير محسوبة)`,
    messageEn: `Base formula percentage must equal 100%. (Base components total ${Number(total.toFixed(4))}% - additives are not included)`,
  };
}

/**
 * Formula rules an ACTIVE version must satisfy on top of the save rules
 * (Step 7A). Shown live in the editor; a draft may be saved while they fail.
 */
export function bomFormulaIssues(version: Record<string, unknown>): BomIssue[] {
  const issues: BomIssue[] = [];
  const f = bomFormula(version);
  const lineNo = (l: FormulaLine) => f.lines.indexOf(l) + 1;
  if (f.basisRequired && !f.basisValid) {
    issues.push({
      field: 'basisQuantity',
      messageAr: 'أساس الخلطة مفقود (MISSING_BOM_BASIS): الإصدار الذي يحتوي نسبًا أو إضافات يحتاج كمية أساس ووحدتها (مثال: 1000 كجم).',
      messageEn: 'Missing BOM basis (MISSING_BOM_BASIS): a version with percentages or additives needs a basis quantity and unit (e.g. 1000 كجم).',
    });
  }
  for (const l of f.lines) {
    if (l.quantity === null && l.percentage !== null && f.basisValid && l.unit !== f.basisUnit) {
      issues.push({ field: 'components.unit', messageAr: `السطر ${lineNo(l)}: مكوّن بالنسبة فقط يجب أن يستخدم وحدة الأساس (${f.basisUnit}).`, messageEn: `Line ${lineNo(l)}: a percentage-only component must use the basis unit (${f.basisUnit}).` });
    }
  }
  const base = f.lines.filter((l) => l.componentType === 'BASE');
  if (f.lines.some((l) => l.componentType === 'ADDITIVE') && base.length === 0) {
    issues.push({ field: 'components', messageAr: 'لا توجد خلطة أساسية - الإضافات تُطبق فوق مكونات أساسية.', messageEn: 'There is no base formula - additives apply on top of base components.' });
  }
  if (f.percentageBased) {
    for (const l of base) {
      if (l.effectivePercentage === null) {
        issues.push({ field: 'components.percentage', messageAr: `السطر ${lineNo(l)}: مكوّن أساسي بدون نسبة (أو كمية بوحدة الأساس) - لا يمكن التحقق من 100%.`, messageEn: `Line ${lineNo(l)}: a base component has no percentage (or quantity in the basis unit) - the 100% cannot be checked.` });
      }
    }
    if (f.baseComplete && Math.abs(f.baseTotal - 100) > PERCENT_TOLERANCE) issues.push(baseTotalIssue(f.baseTotal));
  }
  return issues;
}

// --- Versions ----------------------------------------------------------------------------

export function bomVersionPayloadForSave(input: Record<string, unknown>) {
  const components = Array.isArray(input.components) ? (input.components as Record<string, unknown>[]).map(componentPayload) : [];
  return {
    bomId: text(input.bomId),
    versionCode: text(input.versionCode),
    status: text(input.status).toUpperCase() || 'DRAFT',
    effectiveFrom: optionalId(input.effectiveFrom),
    effectiveTo: optionalId(input.effectiveTo),
    basisQuantity: optionalNumber(input.basisQuantity),
    basisUnit: optionalId(input.basisUnit),
    expectedYieldPercent: optionalNumber(input.expectedYieldPercent),
    notes: text(input.notes),
    components: normaliseSequences(components),
  };
}

function isPositive(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n > 0;
}

export interface BomVersionContext {
  editingId?: string | null;
  knownItems?: KnownItems;
  /** The BOM this version belongs to - used to refuse a component that is the BOM's own item. */
  bom?: Record<string, unknown> | null;
  /** Logical items, so a mapped product and material count as one item. */
  logicalItems?: readonly LogicalItemRecord[];
}

/**
 * Validates a version document (header + components) before the shared write.
 * `versionsOfBom` are the stored versions; only those with the same bomId count.
 */
export function validateBomVersionForSave(versionsOfBom: readonly Stored[], draft: Record<string, unknown>, context: BomVersionContext = {}): BomValidation {
  const issues: BomIssue[] = [];
  const v = bomVersionPayloadForSave(draft);
  const editingId = context.editingId ?? null;
  const siblings = versionsOfBom.filter((e) => text(e.bomId) === v.bomId && String(e.id ?? '') !== String(editingId ?? ''));

  if (!v.bomId) issues.push({ field: 'bomId', messageAr: 'الإصدار يجب أن يتبع قائمة مواد.', messageEn: 'A version must belong to a BOM.' });

  if (!v.versionCode) {
    issues.push({ field: 'versionCode', messageAr: 'رمز الإصدار إلزامي.', messageEn: 'The version code is required.' });
  } else if (siblings.some((e) => codeKey(e.versionCode) === codeKey(v.versionCode))) {
    issues.push({ field: 'versionCode', messageAr: `الإصدار "${v.versionCode}" موجود بالفعل في هذه القائمة.`, messageEn: `Version "${v.versionCode}" already exists in this BOM.` });
  }

  if (!(BOM_VERSION_STATUSES as readonly string[]).includes(v.status)) {
    issues.push({ field: 'status', messageAr: 'حالة الإصدار غير صالحة.', messageEn: `Invalid version status. Allowed: ${BOM_VERSION_STATUSES.join(', ')}.` });
  }

  issues.push(...effectiveDateIssues(v.effectiveFrom, v.effectiveTo));

  const hasBasisQty = v.basisQuantity !== null;
  if (hasBasisQty && !isPositive(v.basisQuantity)) {
    issues.push({ field: 'basisQuantity', messageAr: 'كمية الأساس يجب أن تكون رقمًا أكبر من صفر.', messageEn: 'The basis quantity must be a number greater than zero.' });
  }
  if (hasBasisQty !== (v.basisUnit !== null)) {
    issues.push({ field: 'basisUnit', messageAr: 'كمية الأساس ووحدتها تُدخلان معًا أو تُتركان معًا.', messageEn: 'Enter the basis quantity and its unit together, or neither.' });
  } else if (v.basisUnit !== null && !(BOM_UNITS as readonly string[]).includes(v.basisUnit)) {
    issues.push({ field: 'basisUnit', messageAr: 'وحدة الأساس غير معروفة.', messageEn: 'Unknown basis unit.' });
  }
  if (v.expectedYieldPercent !== null && !(isPositive(v.expectedYieldPercent) && v.expectedYieldPercent <= 100)) {
    issues.push({ field: 'expectedYieldPercent', messageAr: 'نسبة المردود المتوقعة يجب أن تكون بين 0 و100.', messageEn: 'The expected yield must be greater than 0 and at most 100.' });
  }

  // Components ------------------------------------------------------------
  const items = new Set<string>();
  const logicalItems = context.logicalItems ?? [];
  const ownItem = context.bom ? resolveLogicalItemId(logicalItems, text(context.bom.itemSource), text(context.bom.itemId)) : null;
  const rawComponents = Array.isArray(draft.components) ? (draft.components as Record<string, unknown>[]).map(componentPayload) : [];

  issues.push(...lineIdentityIssues(rawComponents, 'components'));

  const rawDraftComponents = Array.isArray(draft.components) ? (draft.components as Record<string, unknown>[]) : [];

  rawComponents.forEach((c, i) => {
    const n = i + 1;
    const line = (ar: string, en: string, field: string) => issues.push({ field: `components.${field}`, messageAr: `السطر ${n}: ${ar}`, messageEn: `Line ${n}: ${en}` });

    // Step 7A: the formula group is a controlled value (absent = BASE).
    const rawType = text(rawDraftComponents[i]?.componentType);
    if (rawType && !(BOM_COMPONENT_TYPES as readonly string[]).includes(rawType.toUpperCase())) {
      line('نوع المكوّن يجب أن يكون أساسي أو إضافة.', 'the component type must be BASE or ADDITIVE.', 'componentType');
    }

    if (!isBomItemSource(c.itemSource) || !c.itemId) {
      line('يجب اختيار الصنف.', 'select the item.', 'itemId');
    } else {
      if (!itemExists(context.knownItems, c.itemSource, c.itemId)) line('الصنف المحدد غير موجود.', 'the selected item does not exist.', 'itemId');
      // Logical identity: a mapped product and material are the same item here.
      const key = resolveLogicalItemId(logicalItems, c.itemSource, c.itemId);
      if (ownItem && key === ownItem) line('لا يمكن أن يكون الصنف (أو صنفه المنطقي المرتبط) مكوّنًا في قائمة مواده نفسها.', 'an item (or its mapped logical item) cannot be a component of its own BOM.', 'itemId');
      if (items.has(key)) line('الصنف مكرر في نفس الإصدار (مباشرة أو عبر صنف منطقي مرتبط).', 'the item is listed twice in this version (directly or through a mapped logical item).', 'itemId');
      items.add(key);
    }

    // A percentage-only line (Step 7A) has no stored quantity; any other line needs one.
    const percentageOnly = c.quantity === null && isValidPercentage(c.percentage);
    if (!isPositive(c.quantity) && !percentageOnly) line('الكمية يجب أن تكون رقمًا أكبر من صفر.', 'quantity must be a number greater than zero.', 'quantity');
    if (!(BOM_UNITS as readonly string[]).includes(c.unit)) line('يجب اختيار وحدة معروفة.', 'choose a known unit.', 'unit');

    if (c.percentage !== null) {
      if (!(isPositive(c.percentage) && c.percentage <= 100)) {
        line('النسبة يجب أن تكون أكبر من 0 وحتى 100.', 'percentage must be greater than 0 and at most 100.', 'percentage');
      } else if (hasBasisQty && isPositive(v.basisQuantity) && v.basisUnit === c.unit && isPositive(c.quantity)) {
        const expected = (v.basisQuantity * c.percentage) / 100;
        if (Math.abs(expected - c.quantity) > (v.basisQuantity * PERCENT_TOLERANCE) / 100) {
          line(
            `الكمية ${c.quantity} لا تطابق ${c.percentage}% من الأساس ${v.basisQuantity} ${c.unit} (${expected}).`,
            `quantity ${c.quantity} does not match ${c.percentage}% of the basis ${v.basisQuantity} ${c.unit} (${expected}).`,
            'percentage',
          );
        }
      }
    }
  });

  // Out-of-range percentages are already reported per line; only valid ones are totalled.
  // Step 7A: only BASE lines make up the 100% - additives are applied on top and never counted.
  const baseComponents = rawComponents.filter((c) => c.componentType === 'BASE');
  const withPct = baseComponents.filter((c) => c.percentage !== null && isValidPercentage(c.percentage));
  if (withPct.length > 0) {
    const total = withPct.reduce((s, c) => s + (c.percentage as number), 0);
    if (total > 100 + PERCENT_TOLERANCE || (withPct.length === baseComponents.length && Math.abs(total - 100) > PERCENT_TOLERANCE)) {
      issues.push(baseTotalIssue(total));
    }
  }

  if (v.status === 'ACTIVE' && rawComponents.length === 0) {
    issues.push({ field: 'components', messageAr: 'لا يمكن تفعيل إصدار بدون مكونات.', messageEn: 'A version cannot be active without components.' });
  }

  // Step 7A: an ACTIVE version must also be a complete formula (basis, 100% base).
  if (v.status === 'ACTIVE') issues.push(...bomFormulaIssues(v));

  // The base-total rule is shared by save and activation - report it once.
  const seen = new Set<string>();
  const unique = issues.filter((i) => {
    const k = `${i.field}|${i.messageEn}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return { valid: unique.length === 0, issues: unique };
}

// --- Lifecycle ------------------------------------------------------------------------------

/**
 * Whether a version may move to `next`.
 *
 *   DRAFT -> ACTIVE   the version must pass full validation, its BOM must be
 *                     active, and no other version of the BOM may be ACTIVE
 *   DRAFT -> RETIRED  always (an unused draft)
 *   ACTIVE -> RETIRED always
 *   anything else     refused - RETIRED is final, ACTIVE never returns to DRAFT
 */
export function validateBomVersionTransition(
  versionsOfBom: readonly Stored[],
  version: Stored,
  next: string,
  context: BomVersionContext = {},
): BomValidation {
  const issues: BomIssue[] = [];
  const lifecycle = versionTransitionIssue(version.status, next);
  if (lifecycle) return { valid: false, issues: [lifecycle] };
  if (text(next).toUpperCase() === 'ACTIVE') {
    if (context.bom && context.bom.active === false) {
      issues.push({ field: 'status', messageAr: 'قائمة المواد معطلة - فعّلها قبل تفعيل إصدار.', messageEn: 'The BOM is inactive - activate it before activating a version.' });
    }
    const otherActive = findOtherActiveVersion(versionsOfBom, 'bomId', version);
    if (otherActive) issues.push(otherActiveVersionIssue(otherActive.versionCode));
    const full = validateBomVersionForSave(versionsOfBom, { ...version, status: 'ACTIVE' }, { ...context, editingId: String(version.id ?? '') || null });
    issues.push(...full.issues);
  }
  return { valid: issues.length === 0, issues };
}

/** A new DRAFT copying another version's basis, yield and components - the only way to change an active recipe. */
export function draftFromVersion(source: Record<string, unknown>, versionCode: string) {
  const base = bomVersionPayloadForSave(source);
  return { ...base, versionCode: text(versionCode), status: 'DRAFT', effectiveFrom: null, effectiveTo: null };
}

// --- Audit descriptions ------------------------------------------------------------------------

/** What changed on a BOM header, for the existing audit log. */
export function describeBomChange(before: Record<string, unknown> | null | undefined, after: Record<string, unknown>): string {
  const a = bomPayloadForSave(after);
  if (!before) {
    return `[BOM_CREATED] ${a.code} - ${a.name} - item ${a.itemSource}/${a.itemId} - ${a.customerId ? `customer ${a.customerId}` : 'standard (no customer)'}${a.isDefault ? ' - default' : ''}`;
  }
  const b = bomPayloadForSave(before);
  const changes: string[] = [];
  if (b.code !== a.code) changes.push(`code ${b.code} -> ${a.code}`);
  if (b.name !== a.name) changes.push(`name ${b.name} -> ${a.name}`);
  if (b.itemSource !== a.itemSource || b.itemId !== a.itemId) changes.push(`item ${b.itemSource}/${b.itemId} -> ${a.itemSource}/${a.itemId}`);
  if (b.customerId !== a.customerId) changes.push(`customer scope ${b.customerId ?? 'standard'} -> ${a.customerId ?? 'standard'}`);
  if (b.isDefault !== a.isDefault) changes.push(`default ${b.isDefault} -> ${a.isDefault}`);
  if (b.active !== a.active) changes.push(`active ${b.active} -> ${a.active}`);
  if (b.notes !== a.notes) changes.push('notes changed');
  return `[BOM_UPDATED] ${a.code}: ${changes.length ? changes.join('; ') : 'no field changes'}`;
}

/** What changed on a version, including component additions, removals and edits, for the existing audit log. */
export function describeBomVersionChange(before: Record<string, unknown> | null | undefined, after: Record<string, unknown>): string {
  const a = bomVersionPayloadForSave(after);
  if (!before) {
    return `[BOM_VERSION_CREATED] bom ${a.bomId} version ${a.versionCode} (${a.status}) - ${a.components.length} component(s)`;
  }
  const b = bomVersionPayloadForSave(before);
  const changes: string[] = [];
  if (b.status !== a.status) changes.push(`status ${b.status} -> ${a.status}`);
  if (b.versionCode !== a.versionCode) changes.push(`version ${b.versionCode} -> ${a.versionCode}`);
  for (const f of ['effectiveFrom', 'effectiveTo', 'basisQuantity', 'basisUnit', 'expectedYieldPercent'] as const) {
    if (b[f] !== a[f]) changes.push(`${f} ${b[f] ?? '-'} -> ${a[f] ?? '-'}`);
  }
  if (b.notes !== a.notes) changes.push('notes changed');
  const beforeLines = new Map(b.components.map((c) => [c.lineId, c]));
  const afterLines = new Map(a.components.map((c) => [c.lineId, c]));
  const added = a.components.filter((c) => !beforeLines.has(c.lineId)).map((c) => `${c.lineId} ${c.componentType} ${c.itemSource}/${c.itemId} ${c.quantity ?? '-'} ${c.unit}${c.percentage !== null ? ` ${formatFormulaPercentage(c.componentType, c.percentage)}` : ''}`);
  const removed = b.components.filter((c) => !afterLines.has(c.lineId)).map((c) => `${c.lineId} ${c.itemSource}/${c.itemId}`);
  const edited = a.components
    .filter((c) => beforeLines.has(c.lineId))
    .map((c) => {
      const o = beforeLines.get(c.lineId)!;
      // Step 7A: the formula group, item, quantity and percentage changes are named, not just the line.
      const details: string[] = [];
      if (o.componentType !== c.componentType) details.push(`type ${o.componentType} -> ${c.componentType}`);
      if (o.itemSource !== c.itemSource || o.itemId !== c.itemId) details.push(`item ${o.itemSource}/${o.itemId} -> ${c.itemSource}/${c.itemId}`);
      if (o.quantity !== c.quantity) details.push(`quantity ${o.quantity ?? '-'} -> ${c.quantity ?? '-'}`);
      if (o.unit !== c.unit) details.push(`unit ${o.unit} -> ${c.unit}`);
      if (o.percentage !== c.percentage) details.push(`percentage ${o.percentage ?? '-'} -> ${c.percentage ?? '-'}`);
      const changed = details.length > 0 || o.sequence !== c.sequence || o.notes !== c.notes;
      return changed ? `${c.lineId}${details.length ? ` (${details.join(', ')})` : ''}` : null;
    })
    .filter((x): x is string => x !== null);
  if (added.length) changes.push(`components added: ${added.join(', ')}`);
  if (removed.length) changes.push(`components removed: ${removed.join(', ')}`);
  if (edited.length) changes.push(`components changed: ${edited.join(', ')}`);
  const tag = b.status !== a.status ? (a.status === 'ACTIVE' ? '[BOM_VERSION_ACTIVATED]' : a.status === 'RETIRED' ? '[BOM_VERSION_RETIRED]' : '[BOM_VERSION_UPDATED]') : '[BOM_VERSION_UPDATED]';
  return `${tag} bom ${a.bomId} version ${a.versionCode}: ${changes.length ? changes.join('; ') : 'no field changes'}`;
}

// --- Legacy mixtures (read-only) ----------------------------------------------------------------

export interface LegacyMixtureLine {
  materialId: string;
  materialCode: string;
  materialName: string;
  quantityKg: number | null;
  percentage: number | null;
}

/**
 * The historical mixture on a product, for display only. Never written back,
 * never converted to a BOM version. Tolerant of partial data.
 */
export function readLegacyMixture(product: Record<string, unknown> | null | undefined): { isLegacyMixture: boolean; lines: LegacyMixtureLine[] } {
  const raw = product && Array.isArray(product.mixtureComponents) ? (product.mixtureComponents as Record<string, unknown>[]) : [];
  const isLegacyMixture = Boolean(product && (product.isMixtureBOM === true || text(product.category) === 'MIXTURE_BOM' || raw.length > 0));
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  return {
    isLegacyMixture,
    lines: raw.map((c) => ({
      materialId: text(c?.materialId),
      materialCode: text(c?.materialCode),
      materialName: text(c?.materialName),
      quantityKg: num(c?.quantityKg),
      percentage: num(c?.percentage),
    })),
  };
}

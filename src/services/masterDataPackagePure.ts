/**
 * The reconciled Master Data package - Phase 1 Step 8E. Pure and Firebase-free.
 *
 * THE PACKAGE is the cleaned master data the business reconciled outside the
 * system: one Product Master sheet (products and raw materials together), one
 * Mixes sheet (one row per BOM component) and one Exceptions sheet recording the
 * decisions already taken. This module reads those sheets and produces rows for
 * the EXISTING entity-import lifecycle - it validates no business rule of its
 * own and writes nothing.
 *
 * EVERY ROW IS AN UPSERT. A product, material or BOM already in ASFOUR is
 * matched by its ASFOUR code or its Odoo external reference and UPDATED; it is
 * never duplicated and its code is never rewritten. Re-running the same package
 * therefore creates nothing new.
 *
 * ODOO IDS ARE EXTERNAL REFERENCES, never ASFOUR ids: they are written into
 * `externalRefs` (system `odoo`, model `product.template` / `mrp.bom`).
 *
 * NOTHING IS GUESSED AND NOTHING IS LOST. A unit ASFOUR does not have is never
 * invented and never converted: the row is DEFERRED (kept, excluded from this
 * import, listed for the future UOM / Stock phase) instead of blocking the
 * package. A code that matches an earlier row once ASFOUR's case-insensitive
 * code normalisation is applied is SKIPPED as a duplicate - the first record
 * stays canonical, the two records are never merged and no second product is
 * created. A component whose code is not in the product master is reported as
 * unresolved, never created from its name. Stock columns (quantity on hand,
 * location) and the costing method are read as provenance only, never written.
 *
 * THE DECISIONS THE BUSINESS ALREADY TOOK are listed below verbatim; they are
 * applied as data, not as inference.
 */
import type { ExternalReference, ItemKind } from '../types';
import { normalizeCode } from '../utils/searchUtils';
import { normaliseUom } from './uomPure';

// --- the approved decisions -----------------------------------------------------------

/** Purchased raw materials, decided: RAW_MATERIAL measured in Ton. */
export const DECIDED_PURCHASED_RAW_MATERIALS: readonly string[] = [
  '21080101138', '2111020002', '2111020138', '2111020142', '2111030032', '2111030035',
];

/** Reject / scrap outputs of brick production, decided: Ton, never a purchased raw material. */
export const DECIDED_SCRAP_REJECT_OUTPUTS: readonly string[] = ['FBFCReject400001', 'FBFCReject400005'];

/** BOM output unit decided as Ton (never Piece). */
export const DECIDED_BOM_OUTPUT_TON: readonly string[] = ['LCC-S9006', 'LCC8004', 'LCC-S8005'];

/**
 * An Odoo identity collision the business decided to IGNORE at this stage: the
 * canonical first row is kept, no second product is created, and the collision
 * is recorded as a non-blocking exception.
 */
export const IGNORED_IDENTITY_COLLISIONS: readonly string[] = ['CHR3600401F'];

/** The package's unit names -> the approved ASFOUR unit. A name table, never a conversion. */
export const PACKAGE_UOM_NAMES: Readonly<Record<string, string>> = {
  ton: 'طن',
  tons: 'طن',
  kg: 'كجم',
  'm³': 'م3',
  m3: 'م3',
  pc: 'قطعة',
  pcs: 'قطعة',
  piece: 'قطعة',
  unit: 'قطعة',
  units: 'قطعة',
  'عدد': 'قطعة',
  'قطعة': 'قطعة',
  'لتر': 'لتر',
  l: 'لتر',
  liter: 'لتر',
  litre: 'لتر',
  'طن': 'طن',
  'كجم': 'كجم',
  // The approved area and length units, as the package may spell them.
  'm²': 'm²',
  m2: 'm²',
  sqm: 'm²',
  'متر': 'متر',
  meter: 'متر',
  metre: 'متر',
};

export const ODOO_PRODUCT_MODEL = 'product.template';
export const ODOO_BOM_MODEL = 'mrp.bom';
export const PACKAGE_BOM_VERSION_CODE = 'V1';

// --- shared helpers --------------------------------------------------------------------

export interface PackageIssue {
  field: string;
  messageAr: string;
  messageEn: string;
}

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim());
const blank = (value: unknown): boolean => text(value) === '';

function num(value: unknown): number | null {
  if (blank(value)) return null;
  const n = typeof value === 'number' ? value : Number(text(value).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

const issue = (field: string, messageAr: string, messageEn: string): PackageIssue => ({ field, messageAr, messageEn });

/** The approved unit a package unit name means; null when the package names a unit ASFOUR does not have. */
export function mapPackageUnit(value: unknown): { unit: string | null; original: string; mapped: boolean } {
  const original = text(value);
  if (!original) return { unit: null, original, mapped: false };
  const approved = normaliseUom(original);
  if (approved.status === 'APPROVED' || approved.status === 'LEGACY_ALIAS') {
    return { unit: approved.normalized, original, mapped: approved.status === 'LEGACY_ALIAS' };
  }
  const named = PACKAGE_UOM_NAMES[original.toLowerCase()];
  return named ? { unit: named, original, mapped: true } : { unit: null, original, mapped: false };
}

/** The Odoo external reference of one package row - the id stays external, never an ASFOUR id. */
export function externalRefOf(odooId: unknown, model: string, code?: unknown): ExternalReference[] {
  const id = text(odooId);
  if (!id) return [];
  return [{ system: 'odoo', model, externalId: id, ...(text(code) ? { externalCode: text(code) } : {}) }];
}

export interface PackageProvenance {
  sourceFile: string;
  sourceSheet: string;
  sourceRow: number;
  /** The package's own "Source Row" column, when it carries one. */
  packageSourceRow: string | null;
  masterSource: string | null;
}

// --- Product Master --------------------------------------------------------------------

export const PRODUCT_MASTER_COLUMNS = {
  code: 'Product Code',
  name: 'Product Name',
  tags: 'Product Tags',
  businessRole: 'Business Role',
  itemKind: 'ItemKind',
  unit: 'Unit of Measure',
  quantityOnHand: 'Quantity On Hand',
  inventoryLocation: 'Inventory Location',
  category: 'Product Category',
  costingMethod: 'Costing Method',
  odooId: 'Odoo External ID',
  masterSource: 'Master Source',
  notes: 'Notes',
} as const;

/** Columns read for provenance only and NEVER written (stock and costing are out of scope). */
export const PRODUCT_MASTER_PROVENANCE_ONLY: readonly string[] = [
  PRODUCT_MASTER_COLUMNS.quantityOnHand,
  PRODUCT_MASTER_COLUMNS.inventoryLocation,
  PRODUCT_MASTER_COLUMNS.costingMethod,
];

const ITEM_KINDS: readonly ItemKind[] = ['RAW_MATERIAL', 'INTERMEDIATE', 'FINISHED_PRODUCT', 'OTHER'];

/**
 * Why a row is not imported now although it is kept in full:
 *   UNSUPPORTED_UOM   its unit is not in the ASFOUR UOM master (future phase)
 *   DUPLICATE_CODE    an earlier row already holds this normalised code
 */
export type PackageDeferralReason = 'UNSUPPORTED_UOM' | 'DUPLICATE_CODE';

export interface PackageProductRow {
  /** Which ASFOUR master the row belongs in - raw materials live in `materials`. */
  kind: 'products' | 'materials';
  /** Set when the row is kept but not imported in this phase. */
  deferral: { reason: PackageDeferralReason; detail: string } | null;
  rowId: string;
  sourceRow: number;
  raw: Record<string, unknown>;
  payload: Record<string, unknown>;
  issues: PackageIssue[];
  warnings: PackageIssue[];
  provenance: PackageProvenance;
}

export function isProductMasterSheet(headers: readonly string[]): boolean {
  const set = new Set(headers.map((h) => text(h)));
  return set.has(PRODUCT_MASTER_COLUMNS.code) && set.has(PRODUCT_MASTER_COLUMNS.name) && set.has(PRODUCT_MASTER_COLUMNS.itemKind);
}

/**
 * One Product Master row -> a product or a material payload. Raw materials go to
 * the `materials` master, everything else to `products`; the decision follows
 * the package's own ItemKind and Business Role, never a guess.
 */
export function readProductMasterRow(
  raw: Record<string, unknown>,
  index: number,
  context: { fileName: string; sheetName: string },
): PackageProductRow {
  const C = PRODUCT_MASTER_COLUMNS;
  const sourceRow = index + 2;
  const issues: PackageIssue[] = [];
  const warnings: PackageIssue[] = [];

  const code = text(raw[C.code]);
  const name = text(raw[C.name]);
  const businessRole = text(raw[C.businessRole]);
  const declaredKind = text(raw[C.itemKind]).toUpperCase();
  const unit = mapPackageUnit(raw[C.unit]);

  let deferral: PackageProductRow['deferral'] = null;
  const decidedRaw = DECIDED_PURCHASED_RAW_MATERIALS.includes(code);
  const decidedScrap = DECIDED_SCRAP_REJECT_OUTPUTS.includes(code);
  const itemKind: ItemKind = decidedRaw
    ? 'RAW_MATERIAL'
    : (ITEM_KINDS as readonly string[]).includes(declaredKind) ? (declaredKind as ItemKind) : 'OTHER';
  const kind: PackageProductRow['kind'] = itemKind === 'RAW_MATERIAL' ? 'materials' : 'products';

  if (!code) issues.push(issue('code', 'كود الصنف مفقود.', 'The item code is missing.'));
  if (!name) issues.push(issue('name', 'اسم الصنف مفقود.', 'The item name is missing.'));
  if (!declaredKind) warnings.push(issue('itemKind', 'تصنيف الصنف غير محدد في الحزمة - يُقرأ كـ OTHER.', 'The package states no item kind - it is read as OTHER.'));

  // The decided units: the six purchased raw materials and the two reject outputs are Ton.
  const decidedUnit = decidedRaw || decidedScrap ? 'طن' : null;
  const finalUnit = decidedUnit ?? unit.unit;
  if (decidedUnit && unit.unit && unit.unit !== decidedUnit) {
    warnings.push(issue('unit',
      `الوحدة المعتمدة لهذا الكود هي "طن" وتم اعتمادها بدلًا من "${unit.original}".`,
      `The approved unit for this code is "طن"; it was applied instead of "${unit.original}".`));
  } else if (!finalUnit) {
    // DEFERRED, not blocking: the row is kept and listed for the future UOM /
    // Stock phase. It is never converted, never guessed and never deleted.
    deferral = {
      reason: 'UNSUPPORTED_UOM' as PackageDeferralReason,
      detail: unit.original || '(blank)',
    };
    warnings.push(issue('unit',
      `وحدة القياس "${unit.original || '-'}" ليست ضمن وحدات ASFOUR - الصف مؤجَّل (UNSUPPORTED_UOM) ويبقى في قائمة المؤجَّل لمرحلة الوحدات/المخزون، بدون تحويل أو حذف.`,
      `Unit of measure "${unit.original || '-'}" is not in the ASFOUR UOM master - the row is DEFERRED (UNSUPPORTED_UOM) and kept in the deferred list for the future UOM / Stock phase; it is never converted and never deleted.`));
  } else if (unit.mapped && !decidedUnit) {
    warnings.push(issue('unit',
      `الوحدة "${unit.original}" قُرئت كـ "${finalUnit}" (مطابقة اسم - بدون تحويل).`,
      `Unit "${unit.original}" read as "${finalUnit}" (a name match - no conversion).`));
  }
  if (decidedScrap) {
    warnings.push(issue('businessRole',
      'هذا الكود ناتج هالك/رفض من التصنيع - ليس خامة مشتراة.',
      'This code is a reject / scrap output of production - not a purchased raw material.'));
  }
  if (IGNORED_IDENTITY_COLLISIONS.includes(code)) {
    warnings.push(issue('code',
      'تصادم هوية في أودو لهذا الكود - تقرر تجاهله في هذه المرحلة ولا يمنع الاستيراد؛ يُعتمد السجل الأساسي فقط.',
      'An Odoo identity collision on this code - decided to be ignored at this stage and non-blocking; only the canonical record is used.'));
  }

  const payload: Record<string, unknown> = {
    code,
    name,
    ...(kind === 'products' ? { productCode: code, productName: name } : {}),
    ...(finalUnit ? { unit: finalUnit } : {}),
    itemKind,
    ...(businessRole ? { businessRole } : {}),
    ...(text(raw[C.category]) ? { category: text(raw[C.category]) } : {}),
    ...(text(raw[C.notes]) ? { notes: text(raw[C.notes]) } : {}),
    active: true,
    externalRefs: externalRefOf(raw[C.odooId], ODOO_PRODUCT_MODEL, code),
  };

  return {
    kind,
    deferral,
    rowId: `${kind}:${code || sourceRow}`,
    sourceRow,
    raw: { ...raw },
    payload,
    issues,
    warnings,
    provenance: {
      sourceFile: context.fileName,
      sourceSheet: context.sheetName,
      sourceRow,
      packageSourceRow: null,
      masterSource: text(raw[C.masterSource]) || null,
    },
  };
}

export function readProductMasterSheet(
  rows: ReadonlyArray<Record<string, unknown>>,
  context: { fileName: string; sheetName: string },
): { rows: PackageProductRow[]; counts: Record<string, number> } {
  const out = rows.map((raw, i) => readProductMasterRow(raw, i, context));
  return {
    rows: out,
    counts: {
      sourceRows: rows.length,
      products: out.filter((r) => r.kind === 'products').length,
      materials: out.filter((r) => r.kind === 'materials').length,
      blocked: out.filter((r) => r.issues.length > 0).length,
      deferred: out.filter((r) => r.deferral !== null).length,
    },
  };
}

// --- Mixes (BOM) -----------------------------------------------------------------------

export const MIXES_COLUMNS = {
  bomReference: 'BOM Reference',
  bomOdooId: 'BOM Odoo ID',
  productCode: 'Product Code',
  productName: 'Product Name',
  productOdooId: 'Product Odoo ID',
  outputQuantity: 'BOM Output Quantity',
  outputUnit: 'BOM Output UOM',
  componentCode: 'Component Code',
  componentName: 'Component Name',
  componentOdooId: 'Component Odoo ID',
  componentQuantity: 'Component Quantity',
  originalUnit: 'Original Source UOM',
  componentUnit: 'Resolved Component UOM',
  componentRole: 'Component Role',
  uomResolution: 'UOM Resolution',
  sourceRow: 'Source Row',
} as const;

export interface PackageBomComponentRow {
  code: string;
  name: string;
  odooId: string | null;
  quantity: number | null;
  unit: string | null;
  unitOriginal: string;
  role: string | null;
  sourceRow: number;
}

export interface PackageBomRow {
  rowId: string;
  /** The BOM's own key in the package: its Odoo id, else its reference. */
  bomKey: string;
  bomReference: string;
  bomOdooId: string | null;
  productCode: string;
  productName: string;
  productOdooId: string | null;
  outputQuantity: number | null;
  outputUnit: string | null;
  components: PackageBomComponentRow[];
  sourceRow: number;
  raw: Record<string, unknown>;
  issues: PackageIssue[];
  warnings: PackageIssue[];
  provenance: PackageProvenance;
}

export function isMixesSheet(headers: readonly string[]): boolean {
  const set = new Set(headers.map((h) => text(h)));
  return set.has(MIXES_COLUMNS.bomReference) && set.has(MIXES_COLUMNS.componentCode) && set.has(MIXES_COLUMNS.componentQuantity);
}

/**
 * The Mixes sheet - one row per component - folded into one BOM per Odoo BOM id.
 * The component order in the file is the sequence: it is the file's own order,
 * not an invented one. Nothing is summed and no component is dropped.
 */
export function readMixesSheet(
  rows: ReadonlyArray<Record<string, unknown>>,
  context: { fileName: string; sheetName: string },
): { rows: PackageBomRow[]; counts: Record<string, number> } {
  return readMixesSheets([{ ...context, rows }]);
}

/**
 * Every Mixes sheet of the package folded together. The package is split into
 * part files purely by size, so ONE BOM can start in one part and continue in
 * the next: its components are joined here by the BOM's own key, never treated
 * as two BOMs and never dropped.
 */
export function readMixesSheets(
  sheets: ReadonlyArray<{ fileName: string; sheetName: string; rows: ReadonlyArray<Record<string, unknown>> }>,
): { rows: PackageBomRow[]; counts: Record<string, number> } {
  const C = MIXES_COLUMNS;
  const byKey = new Map<string, PackageBomRow>();
  let sourceRowCount = 0;

  for (const sheet of sheets) {
  const context = { fileName: sheet.fileName, sheetName: sheet.sheetName };
  const rows = sheet.rows;
  sourceRowCount += rows.length;
  rows.forEach((raw, index) => {
    const sourceRow = index + 2;
    const bomReference = text(raw[C.bomReference]);
    const bomOdooId = text(raw[C.bomOdooId]);
    const key = bomOdooId || bomReference;
    const productCode = text(raw[C.productCode]);

    let bom = byKey.get(key);
    if (!bom) {
      const outputUnit = mapPackageUnit(raw[C.outputUnit]);
      const decidedTon = DECIDED_BOM_OUTPUT_TON.includes(productCode) || DECIDED_BOM_OUTPUT_TON.includes(bomReference);
      const finalOutputUnit = decidedTon ? 'طن' : outputUnit.unit;
      bom = {
        rowId: `bomPackage:${key || sourceRow}`,
        bomKey: key,
        bomReference,
        bomOdooId: bomOdooId || null,
        productCode,
        productName: text(raw[C.productName]),
        productOdooId: text(raw[C.productOdooId]) || null,
        outputQuantity: num(raw[C.outputQuantity]),
        outputUnit: finalOutputUnit,
        components: [],
        sourceRow,
        raw: { ...raw },
        issues: [],
        warnings: [],
        provenance: {
          sourceFile: context.fileName,
          sourceSheet: context.sheetName,
          sourceRow,
          packageSourceRow: text(raw[C.sourceRow]) || null,
          masterSource: null,
        },
      };
      if (!key) bom.issues.push(issue('bomReference', 'لا يوجد مرجع ولا معرّف أودو لقائمة المواد.', 'The BOM has neither a reference nor an Odoo id.'));
      if (!productCode) bom.issues.push(issue('productCode', 'كود منتج قائمة المواد مفقود.', 'The BOM product code is missing.'));
      if (bom.outputQuantity === null || bom.outputQuantity <= 0) {
        bom.issues.push(issue('outputQuantity', 'كمية مخرجات قائمة المواد غير صالحة.', 'The BOM output quantity is not valid.'));
      }
      if (!finalOutputUnit) {
        bom.issues.push(issue('outputUnit',
          `وحدة مخرجات قائمة المواد "${outputUnit.original || '-'}" ليست وحدة معتمدة.`,
          `The BOM output unit "${outputUnit.original || '-'}" is not an approved unit.`));
      }
      if (decidedTon) {
        bom.warnings.push(issue('outputUnit',
          'وحدة مخرجات هذه الخلطة معتمدة "طن" بقرار موثق (وليست قطعة).',
          'This mix\'s output unit is Ton by a recorded decision (not Piece).'));
      }
      byKey.set(key, bom);
    } else if (productCode && bom.productCode && productCode !== bom.productCode) {
      bom.issues.push(issue('productCode',
        `صفوف قائمة المواد "${bom.bomReference}" تذكر أكثر من منتج ("${bom.productCode}" و"${productCode}").`,
        `The rows of BOM "${bom.bomReference}" name more than one product ("${bom.productCode}" and "${productCode}").`));
    }

    const componentCode = text(raw[C.componentCode]);
    const componentUnit = mapPackageUnit(raw[C.componentUnit] || raw[C.originalUnit]);
    const quantity = num(raw[C.componentQuantity]);
    if (!componentCode) {
      bom.issues.push(issue(`components.${bom.components.length + 1}.code`,
        `صف مكوّن بلا كود (صف ${sourceRow}) - لا يتم إنشاء صنف من الاسم.`,
        `A component row with no code (row ${sourceRow}) - no item is created from a name.`));
    }
    if (quantity === null) {
      bom.issues.push(issue(`components.${bom.components.length + 1}.quantity`,
        `كمية المكوّن "${componentCode || text(raw[C.componentName])}" غير رقمية.`,
        `The quantity of component "${componentCode || text(raw[C.componentName])}" is not a number.`));
    }
    if (!componentUnit.unit) {
      bom.issues.push(issue(`components.${bom.components.length + 1}.unit`,
        `وحدة المكوّن "${componentUnit.original || '-'}" غير معتمدة - لا تخمين.`,
        `The component unit "${componentUnit.original || '-'}" is not approved - nothing is guessed.`));
    }
    bom.components.push({
      code: componentCode,
      name: text(raw[C.componentName]),
      odooId: text(raw[C.componentOdooId]) || null,
      quantity,
      unit: componentUnit.unit,
      unitOriginal: componentUnit.original,
      role: text(raw[C.componentRole]) || null,
      sourceRow,
    });

  });
  }

  const out = [...byKey.values()];
  for (const bom of out) {
    if (bom.components.length === 0) {
      bom.issues.push(issue('components', 'قائمة مواد بلا مكوّنات.', 'A BOM with no components.'));
    }
  }
  return {
    rows: out,
    counts: {
      sourceRows: sourceRowCount,
      boms: out.length,
      components: out.reduce((n, b) => n + b.components.length, 0),
      blocked: out.filter((b) => b.issues.length > 0).length,
    },
  };
}

// --- Exceptions ------------------------------------------------------------------------

export interface PackageException {
  type: string;
  key: string;
  current: string;
  previous: string;
  resolved: string;
  note: string;
  /** An exception the business decided not to block on. */
  blocking: boolean;
  sourceRow: number;
}

export function isExceptionsSheet(headers: readonly string[]): boolean {
  const set = new Set(headers.map((h) => text(h)));
  return set.has('Exception Type') && set.has('Key');
}

export function readExceptionsSheet(rows: ReadonlyArray<Record<string, unknown>>): PackageException[] {
  return rows.map((raw, index) => {
    const key = text(raw.Key);
    const type = text(raw['Exception Type']);
    return {
      type,
      key,
      current: text(raw['Existing/Current']),
      previous: text(raw['Previous Value']),
      resolved: text(raw['Resolved Value']),
      note: text(raw['Action / Note']),
      // The recorded decision: the known identity collision does not block.
      blocking: type === 'BLOCKING_CODE_COLLISION' && !IGNORED_IDENTITY_COLLISIONS.includes(key),
      sourceRow: index + 2,
    };
  });
}

// --- upsert identity -------------------------------------------------------------------

type Stored = Record<string, unknown> & { id?: string };

/**
 * The existing record this row updates: the same ASFOUR code first, then the
 * same Odoo external reference. Nothing is matched by name.
 */
/**
 * Lookup tables over one list of existing records, built once per list and
 * re-built if the list grows. Every table keeps the FIRST record in list order
 * for a key - exactly what the linear `find` / first-of-`filter` it replaces
 * returned - so matching is unchanged; only a 16,000-record package stops being
 * quadratic.
 */
interface RecordIndex {
  length: number;
  /** normalised `code` OR `productCode` -> first record carrying it. */
  byItemCode: Map<string, Stored>;
  /** normalised `code` only -> first record. */
  byCode: Map<string, Stored>;
  /** `system` + external id -> first record carrying that reference. */
  byRef: Map<string, Stored>;
  /** bomId + normalised version code -> first version. */
  byVersion: Map<string, Stored>;
}
const recordIndexCache = new WeakMap<readonly Stored[], RecordIndex>();
const refKey = (system: unknown, externalId: unknown) => `${text(system)}\u0000${text(externalId)}`;

function indexOf(list: readonly Stored[]): RecordIndex {
  const cached = recordIndexCache.get(list);
  if (cached && cached.length === list.length) return cached;
  const index: RecordIndex = { length: list.length, byItemCode: new Map(), byCode: new Map(), byRef: new Map(), byVersion: new Map() };
  const first = <K>(map: Map<K, Stored>, key: K, record: Stored) => { if (!map.has(key)) map.set(key, record); };
  for (const record of list) {
    const code = normalizeCode(text(record.code));
    const productCode = normalizeCode(text(record.productCode));
    if (code) { first(index.byItemCode, code, record); first(index.byCode, code, record); }
    if (productCode) first(index.byItemCode, productCode, record);
    for (const ref of Array.isArray(record.externalRefs) ? (record.externalRefs as ExternalReference[]) : []) {
      if (text(ref.externalId)) first(index.byRef, refKey(ref.system, ref.externalId), record);
    }
    if (text(record.bomId)) first(index.byVersion, `${text(record.bomId)}\u0000${normalizeCode(text(record.versionCode))}`, record);
  }
  recordIndexCache.set(list, index);
  return index;
}

export function findExistingMasterRecord(
  existing: readonly Stored[] | null | undefined,
  payload: Record<string, unknown>,
): { record: Stored | null; matchedBy: 'CODE' | 'EXTERNAL_REFERENCE' | 'NONE' } {
  const index = indexOf(existing ?? []);
  const code = normalizeCode(text(payload.code));
  if (code) {
    const byCode = index.byItemCode.get(code);
    if (byCode) return { record: byCode, matchedBy: 'CODE' };
  }
  const refs = Array.isArray(payload.externalRefs) ? (payload.externalRefs as ExternalReference[]) : [];
  for (const ref of refs) {
    const id = text(ref.externalId);
    if (!id) continue;
    const byRef = index.byRef.get(refKey(ref.system, id));
    if (byRef) return { record: byRef, matchedBy: 'EXTERNAL_REFERENCE' };
  }
  return { record: null, matchedBy: 'NONE' };
}

/** Deterministic JSON: object keys sorted, so equal data compares equal whatever its key order. */
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value as Record<string, unknown>).sort().map((k) => `${JSON.stringify(k)}:${stableJson((value as Record<string, unknown>)[k])}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

/**
 * The part of an update patch that would actually change the stored record. An
 * empty result means the write is a NO-OP and is skipped - so re-running the
 * same package rewrites nothing it already holds.
 */
export function changedFieldsOnly(current: Record<string, unknown> | null | undefined, patch: Record<string, unknown>): Record<string, unknown> {
  if (!current) return { ...patch };
  const changed: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(patch)) {
    if (stableJson(current[field]) !== stableJson(value)) changed[field] = value;
  }
  return changed;
}

/** The fields an existing master record may receive from the package - never its code. */
export const UPDATABLE_MASTER_FIELDS: readonly string[] = ['name', 'productName', 'unit', 'category', 'itemKind', 'businessRole', 'notes', 'externalRefs'];

/**
 * Validates one product / material package row and returns what would be
 * written, including the existing record it updates. Pure.
 */
export function validateMasterDataPackageRow(
  kind: 'products' | 'materials',
  payload: Record<string, unknown>,
  existing: readonly Stored[] | null | undefined,
): { issues: PackageIssue[]; warnings: PackageIssue[]; payload: Record<string, unknown> } {
  const issues: PackageIssue[] = [];
  const warnings: PackageIssue[] = [];
  const code = text(payload.code);
  const name = text(payload.name);
  const unit = text(payload.unit);

  if (!code) issues.push(issue('code', 'كود الصنف إلزامي.', 'The item code is required.'));
  if (!name) issues.push(issue('name', 'اسم الصنف إلزامي.', 'The item name is required.'));
  if (unit) {
    const normalised = normaliseUom(unit);
    if (normalised.status !== 'APPROVED') {
      issues.push(issue('unit', `الوحدة "${unit}" ليست وحدة معتمدة.`, `Unit "${unit}" is not an approved unit.`));
    }
  } else if (kind === 'materials') {
    // Kept and deferred like any other unsupported unit - never blocked, never guessed.
    warnings.push(issue('unit', 'الخامة بلا وحدة - مؤجَّلة لمرحلة الوحدات.', 'The material has no unit - deferred to the UOM phase.'));
  }

  const found = findExistingMasterRecord(existing, payload);
  if (found.record) {
    warnings.push(issue('code',
      `الصنف موجود بالفعل (${found.matchedBy === 'CODE' ? 'بنفس الكود' : 'بنفس مرجع أودو'}) - سيتم تحديثه ولن يُنشأ صنف جديد.`,
      `This item already exists (matched by ${found.matchedBy === 'CODE' ? 'its code' : 'its Odoo reference'}) - it is updated, not created again.`));
  }

  return {
    issues,
    warnings,
    payload: {
      ...payload,
      existingId: found.record?.id ?? null,
      upsertAction: found.record ? 'UPDATE' : 'CREATE',
      matchedBy: found.matchedBy,
    },
  };
}

/** The BOM this package row updates: the same Odoo BOM reference first, then the same BOM code. */
export function findExistingBom(
  existing: readonly Stored[] | null | undefined,
  input: { odooBomId: string | null; code: string },
): { record: Stored | null; matchedBy: 'EXTERNAL_REFERENCE' | 'CODE' | 'NONE' } {
  const index = indexOf(existing ?? []);
  const odooId = text(input.odooBomId);
  if (odooId) {
    const byRef = index.byRef.get(refKey('odoo', odooId));
    if (byRef) return { record: byRef, matchedBy: 'EXTERNAL_REFERENCE' };
  }
  const code = normalizeCode(text(input.code));
  if (code) {
    const byCode = index.byCode.get(code);
    if (byCode) return { record: byCode, matchedBy: 'CODE' };
  }
  return { record: null, matchedBy: 'NONE' };
}

/** The package's single version of one BOM, when it already exists. */
export function findExistingBomVersion(
  existing: readonly Stored[] | null | undefined,
  bomId: string,
  versionCode: string = PACKAGE_BOM_VERSION_CODE,
): Stored | null {
  return indexOf(existing ?? []).byVersion.get(`${text(bomId)}\u0000${normalizeCode(versionCode)}`) ?? null;
}

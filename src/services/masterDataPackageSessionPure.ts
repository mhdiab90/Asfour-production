/**
 * The Master Data package as an import session - Phase 1 Step 8E.
 * Pure and Firebase-free.
 *
 * The package's sheets are turned into rows of the EXISTING entity-import
 * lifecycle (entityImportPure): products, materials and one `bomPackage` row per
 * BOM with its components. Every row keeps its raw sheet row, its provenance and
 * its own validation outcome, so a bad row never blocks a good one.
 *
 * THE ORDER MATTERS AND IS DETERMINISTIC: products and materials first, BOMs
 * after them, because a BOM's product and components must resolve to items that
 * exist (or are created in the same run).
 *
 * NOTHING IS WRITTEN HERE and nothing is resolved against Firestore - the
 * resolution and the writes stay in the existing services.
 *
 * WHAT THE ROW CARRIES. An import row's `originalRowData` is the payload this
 * package row would write, because the execution revalidates from it before
 * writing. The untouched Excel row is kept beside it on `rawRow`, so the review
 * can always show the source line behind any value.
 *
 * THREE OUTCOMES BESIDES "IMPORT", and none of them stops another row:
 *   SKIPPED / DUPLICATE_CODE      a later row whose code equals an earlier row's
 *                                 once ASFOUR's case-insensitive normalisation is
 *                                 applied. The FIRST record stays canonical, the
 *                                 two are never merged, and no second product is
 *                                 created. The skipped source row and its reason
 *                                 are kept on the row's own decision history.
 *   EXCLUDED / UNSUPPORTED_UOM    its unit is not in the ASFOUR UOM master. The
 *                                 row is kept and listed as DEFERRED for the
 *                                 future UOM / Stock phase - never converted,
 *                                 never deleted.
 *   BLOCKING                      a genuine data error (a missing code or name, a
 *                                 BOM component that resolves to nothing).
 *
 * ITEMS DEFINED BY THE SAME PACKAGE (the 3.21.0 defect this closes). A BOM may
 * point at a product or material that the package itself creates, which has no
 * ASFOUR id before it is written. Such a reference is carried as a PENDING
 * PACKAGE-ITEM TOKEN (`pending-package-item:<kind>:<CODE>`) - clearly not an id,
 * never persisted. The preview validates every BOM with the SAME validator the
 * write uses, over an in-memory context of the existing items plus the package's
 * own items under those tokens; and a BOM whose package item will not be written
 * (blocked, skipped, excluded or with warnings not accepted) is BLOCKING with that
 * reason. The execution writes products and materials first, binds each token to
 * the id the write returned, and only then revalidates and writes the BOM - so
 * what the preview calls importable is exactly what the import writes.
 */
import type { ImportRow } from './entityImportPure';
import { applyValidation, createImportRow, isRowWritable, rowPayload, setRowSelection, type ImportIssue } from './entityImportPure';
import { resolveAndValidateImportRow, type ImportValidationContext, type ImportValidationResult } from './importEntityValidationPure';
import {
  PACKAGE_BOM_VERSION_CODE,
  findExistingBom,
  findExistingBomVersion,
  findExistingMasterRecord,
  isExceptionsSheet,
  isMixesSheet,
  isProductMasterSheet,
  readExceptionsSheet,
  readMixesSheets,
  readProductMasterSheet,
  validateMasterDataPackageRow,
  type PackageBomRow,
  type PackageDeferralReason,
  type PackageException,
  type PackageProductRow,
  type PackageProvenance,
} from './masterDataPackagePure';
import { externalRefOf, ODOO_BOM_MODEL } from './masterDataPackagePure';
import { normalizeCode } from '../utils/searchUtils';

type Stored = Record<string, unknown> & { id?: string };

export type PackageSheetKind = 'PRODUCT_MASTER' | 'MIXES' | 'EXCEPTIONS' | 'UNKNOWN';

export function packageSheetKind(headers: readonly string[]): PackageSheetKind {
  if (isProductMasterSheet(headers)) return 'PRODUCT_MASTER';
  if (isMixesSheet(headers)) return 'MIXES';
  if (isExceptionsSheet(headers)) return 'EXCEPTIONS';
  return 'UNKNOWN';
}

export interface PackageStagedRow {
  row: ImportRow;
  kind: 'products' | 'materials' | 'bomPackage';
  rawRow: Record<string, unknown>;
  provenance: PackageProvenance;
  /** Why the row is kept but not imported now - null when it is importable. */
  deferral: { reason: PackageDeferralReason; detail: string } | null;
  /** CREATE or UPDATE, decided by the existing record this row matched. */
  upsertAction: 'CREATE' | 'UPDATE';
  matchedBy: string;
  /** For a BOM row: how many components it carries. */
  componentCount?: number;
  /**
   * For a BOM row: the package's own structural findings (a BOM repeated inside
   * the package, a code that resolves to nothing). The shared BOM validators and
   * the dependency check are added to these on every evaluation.
   */
  baseIssues?: { errors: ImportIssue[]; warnings: ImportIssue[] };
}

// ==================================================================================
// Pending package-item tokens
// ==================================================================================

/** Marks an item the package defines but ASFOUR does not hold yet. Never an id, never written. */
export const PACKAGE_ITEM_TOKEN_PREFIX = 'pending-package-item:';

export type PackageItemKind = 'products' | 'materials';

/** The key a package item is known by within one run: its kind and its normalised code. */
export function packageItemKey(kind: PackageItemKind, code: string): string {
  return `${kind}:${normalizeCode(code)}`;
}

export function packageItemToken(kind: PackageItemKind, code: string): string {
  return `${PACKAGE_ITEM_TOKEN_PREFIX}${packageItemKey(kind, code)}`;
}

export function isPackageItemToken(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith(PACKAGE_ITEM_TOKEN_PREFIX);
}

/** Every pending token a BOM payload refers to: its product, then its components. */
export function packageItemTokensOf(payload: Record<string, unknown>): string[] {
  const bom = (payload.bom ?? {}) as Record<string, unknown>;
  const version = (payload.version ?? {}) as Record<string, unknown>;
  const components = Array.isArray(version.components) ? (version.components as Array<Record<string, unknown>>) : [];
  const tokens = [bom.itemId, ...components.map((c) => c.itemId)].filter(isPackageItemToken);
  return [...new Set(tokens)];
}

/**
 * Replaces every pending token of a BOM payload with the ASFOUR id its package
 * item received when it was written in this run. A token with no id yet is
 * reported, never guessed and never written.
 */
export function bindPackageItemReferences(
  payload: Record<string, unknown>,
  idsByKey: ReadonlyMap<string, string>,
): { payload: Record<string, unknown>; unresolved: string[] } {
  const unresolved: string[] = [];
  const bind = (value: unknown): unknown => {
    if (!isPackageItemToken(value)) return value;
    const key = value.slice(PACKAGE_ITEM_TOKEN_PREFIX.length);
    const id = idsByKey.get(key);
    if (!id) {
      if (!unresolved.includes(key)) unresolved.push(key);
      return value;
    }
    return id;
  };
  const bom = { ...((payload.bom ?? {}) as Record<string, unknown>) };
  bom.itemId = bind(bom.itemId);
  const version = { ...((payload.version ?? {}) as Record<string, unknown>) };
  if (Array.isArray(version.components)) {
    version.components = (version.components as Array<Record<string, unknown>>).map((c) => ({ ...c, itemId: bind(c.itemId) }));
  }
  return { payload: { ...payload, bom, version }, unresolved };
}

/** Who and when a package decision is recorded as - deterministic, so a re-run is identical. */
export const PACKAGE_DECISION_AUTHOR = 'MASTER_DATA_PACKAGE';
export const PACKAGE_DECISION_TIME = 'PACKAGE_RULE';

/**
 * What the single version says about itself: an internal ASFOUR version created
 * only because the model needs one - never presented as an Odoo historical
 * version, and carrying no invented effective date.
 */
export const PACKAGE_BOM_VERSION_NOTE = 'INTERNAL ASFOUR VERSION - created because the BOM model requires a version entity. The package carries no Odoo BOM version and no effective dates; the Odoo BOM id is kept as an external reference. Activation is a separate human-approved step.';

export interface PackageSessionInput {
  importSessionId: string;
  /** Fixed decision timestamp, so the same package always produces the same session. */
  decidedAt?: string;
  /** Every Product Master sheet of the package, in file order. */
  productSheets: ReadonlyArray<{ fileName: string; sheetName: string; rows: ReadonlyArray<Record<string, unknown>> }>;
  mixSheets: ReadonlyArray<{ fileName: string; sheetName: string; rows: ReadonlyArray<Record<string, unknown>> }>;
  exceptionSheets: ReadonlyArray<{ fileName: string; sheetName: string; rows: ReadonlyArray<Record<string, unknown>> }>;
  /** What ASFOUR already holds - used to decide CREATE vs UPDATE. */
  existing: {
    products?: readonly Stored[] | null;
    materials?: readonly Stored[] | null;
    boms?: readonly Stored[] | null;
    bomVersions?: readonly Stored[] | null;
  };
  /**
   * The rest of the context the shared validators read (customers, logical
   * items...), exactly as the import loads it. Optional: without it the BOM
   * validators see only `existing`.
   */
  validationContext?: ImportValidationContext;
}

export interface PackageSessionResult {
  importSessionId: string;
  staged: PackageStagedRow[];
  /**
   * The in-memory context the preview validates BOMs against: the existing items
   * plus every item the package creates, under its pending token. Used only to
   * validate - never written, and never passed to the execution.
   */
  previewContext: ImportValidationContext;
  /** Each pending token -> the row id of the package row that creates that item. */
  itemRowIds: Record<string, string>;
  exceptions: PackageException[];
  counts: Record<string, number>;
  /** Units the package uses that ASFOUR does not approve - reported, never guessed. */
  unresolvedUnits: Array<{ unit: string; rows: number }>;
  /** Every row kept but not imported now, with the reason and its source row. */
  deferred: Array<{
    rowId: string;
    kind: string;
    code: string;
    name: string;
    reason: PackageDeferralReason;
    detail: string;
    sourceFile: string;
    sourceRow: number;
  }>;
}

const issue = (field: string, messageAr: string, messageEn: string): ImportIssue => ({ field, messageAr, messageEn });

/** The item a BOM row points at, by code, across products and materials. */
function findItem(
  code: string,
  products: readonly Stored[] | null | undefined,
  materials: readonly Stored[] | null | undefined,
  packageItems: Map<string, { itemSource: 'products' | 'materials'; itemId: string }>,
): { itemSource: 'products' | 'materials'; itemId: string } | null {
  const key = normalizeCode(code);
  if (!key) return null;
  // Indexed lookups (first match in list order, as before): products by code or productCode, materials by code.
  const product = findExistingMasterRecord(products, { code }).record;
  if (product) return { itemSource: 'products', itemId: String(product.id ?? '') };
  const material = findExistingBom(materials, { odooBomId: null, code }).record;
  if (material) return { itemSource: 'materials', itemId: String(material.id ?? '') };
  return packageItems.get(key) ?? null;
}

/**
 * Builds the session. Deterministic: the same package always produces the same
 * rows, in the same order, with the same statuses.
 */
export function buildMasterDataPackageSession(input: PackageSessionInput): PackageSessionResult {
  const staged: PackageStagedRow[] = [];
  const unitProblems = new Map<string, number>();

  /**
   * Every item the package itself defines, so a BOM can point at an item created
   * in the same run - under its pending token, never a blank id.
   */
  const packageItems = new Map<string, { itemSource: 'products' | 'materials'; itemId: string }>();
  const itemRowIds: Record<string, string> = {};
  /** The package's new items as the preview validators see them. */
  const pendingItems: { products: Stored[]; materials: Stored[] } = { products: [], materials: [] };

  // --- products and materials ------------------------------------------------------------
  const productRows: PackageProductRow[] = [];
  for (const sheet of input.productSheets) {
    const read = readProductMasterSheet(sheet.rows, { fileName: sheet.fileName, sheetName: sheet.sheetName });
    productRows.push(...read.rows);
  }

  const seenCodes = new Map<string, PackageProductRow>();
  for (const item of productRows) {
    const code = normalizeCode(String(item.payload.code ?? ''));
    const duplicate = code ? seenCodes.get(code) : undefined;
    const errors = [...item.issues];
    const warnings = [...item.warnings];
    let deferral: PackageStagedRow['deferral'] = item.deferral;
    if (duplicate) {
      /*
       * A code that equals an earlier one under ASFOUR's case-insensitive code
       * normalisation. The FIRST record stays canonical; this row is SKIPPED
       * (never blocking, never merged, and no second product is created). The
       * source row and the reason stay on the row for the audit.
       */
      deferral = {
        reason: 'DUPLICATE_CODE',
        detail: `first kept: "${duplicate.payload.code}" (row ${duplicate.sourceRow})`,
      };
      warnings.push(issue('code',
        `كود مكرر بعد التوحيد القياسي (حروف كبيرة/صغيرة): "${item.payload.code}" يطابق "${duplicate.payload.code}" في الصف ${duplicate.sourceRow}. يُعتمد السجل الأول ويُتخطى هذا الصف (SKIPPED / DUPLICATE) بدون دمج وبدون إنشاء منتج ثانٍ.`,
        `Duplicate code after normalisation (letter case): "${item.payload.code}" equals "${duplicate.payload.code}" at row ${duplicate.sourceRow}. The first record is kept and this row is SKIPPED / DUPLICATE - nothing is merged and no second product is created.`));
    } else if (code) {
      seenCodes.set(code, item);
      packageItems.set(code, { itemSource: item.kind, itemId: packageItemToken(item.kind, String(item.payload.code)) });
    }
    if (item.deferral?.reason === 'UNSUPPORTED_UOM') {
      const unit = item.deferral.detail;
      unitProblems.set(unit, (unitProblems.get(unit) ?? 0) + 1);
    }

    const existingList = item.kind === 'products' ? input.existing.products : input.existing.materials;
    const validated = validateAgainstExisting(item, existingList);
    let row = applyValidation(
      createImportRow(item.kind, item.sourceRow, validated.payload, `${item.kind}:${item.payload.code || item.sourceRow}:${item.sourceRow}`),
      { errors: [...errors, ...validated.errors], warnings: [...warnings, ...validated.warnings], normalized: errors.length || validated.errors.length ? null : validated.payload },
    );
    if (code && !duplicate) {
      const token = packageItemToken(item.kind, String(item.payload.code));
      itemRowIds[token] = row.rowId;
      // Only an item ASFOUR does not hold yet needs a pending identity; an
      // existing one is referenced by its own id (findItem prefers it).
      if (validated.payload.upsertAction === 'CREATE') {
        const { existingId: _existingId, upsertAction: _upsertAction, matchedBy: _matchedBy, ...record } = validated.payload;
        pendingItems[item.kind].push({ ...record, id: token });
      }
    }
    if (deferral) {
      // A duplicate is skipped; an unsupported unit is excluded and deferred.
      // Both keep their source row, their reason and their place in the review.
      row = setRowSelection(row, deferral.reason === 'DUPLICATE_CODE' ? 'SKIPPED' : 'EXCLUDED', {
        user: PACKAGE_DECISION_AUTHOR,
        at: input.decidedAt ?? PACKAGE_DECISION_TIME,
        reason: `${deferral.reason}: ${deferral.detail}`,
      });
    }
    staged.push({
      row,
      kind: item.kind,
      rawRow: item.raw,
      provenance: item.provenance,
      deferral,
      upsertAction: validated.payload.upsertAction as 'CREATE' | 'UPDATE',
      matchedBy: String(validated.payload.matchedBy ?? 'NONE'),
    });
  }

  // --- BOMs -------------------------------------------------------------------------------
  // All Mixes sheets at once: a BOM split across two part files stays ONE BOM.
  const bomRows: PackageBomRow[] = readMixesSheets(input.mixSheets.map((s) => ({ fileName: s.fileName, sheetName: s.sheetName, rows: s.rows }))).rows;

  const seenBomKeys = new Map<string, PackageBomRow>();
  for (const bom of bomRows) {
    const errors: ImportIssue[] = [...bom.issues];
    const warnings: ImportIssue[] = [...bom.warnings];

    const duplicate = seenBomKeys.get(bom.bomKey);
    if (duplicate && duplicate !== bom) {
      errors.push(issue('bomReference', `قائمة المواد "${bom.bomKey}" مكررة داخل الحزمة.`, `BOM "${bom.bomKey}" appears more than once inside the package.`));
    } else {
      seenBomKeys.set(bom.bomKey, bom);
    }

    const product = findItem(bom.productCode, input.existing.products, input.existing.materials, packageItems);
    if (!product) {
      errors.push(issue('productCode',
        `منتج قائمة المواد "${bom.productCode}" غير موجود في البيانات الأساسية ولا في الحزمة.`,
        `The BOM product "${bom.productCode}" exists neither in the master data nor in the package.`));
    }

    const components = bom.components.map((c, index) => {
      const item = findItem(c.code, input.existing.products, input.existing.materials, packageItems);
      if (!item) {
        errors.push(issue(`components.${index + 1}.itemId`,
          `المكوّن "${c.code}" غير موجود - لا يتم إنشاء صنف من الاسم.`,
          `Component "${c.code}" does not exist - no item is created from a name.`));
      }
      if (!c.unit) unitProblems.set(c.unitOriginal || '(blank)', (unitProblems.get(c.unitOriginal || '(blank)') ?? 0) + 1);
      return {
        lineId: `L${index + 1}`,
        // The file's own order is the sequence - never an invented one.
        sequence: index + 1,
        itemSource: item?.itemSource ?? 'products',
        itemId: item?.itemId ?? '',
        itemCode: c.code,
        quantity: c.quantity,
        unit: c.unit ?? c.unitOriginal,
        // componentType is deliberately absent: the package states no BASE / ADDITIVE split.
        notes: c.role && c.role !== 'COMPONENT' ? c.role : undefined,
      };
    });

    const existingBom = findExistingBom(input.existing.boms, { odooBomId: bom.bomOdooId, code: bom.bomReference });
    const existingVersion = existingBom.record?.id
      ? findExistingBomVersion(input.existing.bomVersions, String(existingBom.record.id), PACKAGE_BOM_VERSION_CODE)
      : null;
    if (existingBom.record) {
      warnings.push(issue('bomReference',
        `قائمة المواد موجودة بالفعل (${existingBom.matchedBy === 'CODE' ? 'بنفس الكود' : 'بنفس مرجع أودو'}) - سيتم تحديثها ولن تُنشأ نسخة جديدة.`,
        `The BOM already exists (matched by ${existingBom.matchedBy === 'CODE' ? 'its code' : 'its Odoo reference'}) - it is updated, not created again.`));
    }
    if (existingVersion) {
      warnings.push(issue('version',
        'إصدار هذه القائمة موجود بالفعل - لن يُعاد كتابته.',
        'This BOM already has its package version - it is not rewritten.'));
    }

    const payload = {
      bom: {
        code: bom.bomReference,
        name: bom.productName || bom.bomReference,
        itemSource: product?.itemSource ?? 'products',
        itemId: product?.itemId ?? '',
        isDefault: false,
        active: true,
        externalRefs: externalRefOf(bom.bomOdooId, ODOO_BOM_MODEL, bom.bomReference),
      },
      version: {
        versionCode: PACKAGE_BOM_VERSION_CODE,
        // The lowest value the model allows: activation stays a deliberate human step.
        status: 'DRAFT',
        // Effective dates are left blank - the package states none and none is invented.
        effectiveFrom: null,
        effectiveTo: null,
        notes: PACKAGE_BOM_VERSION_NOTE,
        basisQuantity: bom.outputQuantity,
        basisUnit: bom.outputUnit,
        components,
      },
      existingBomId: existingBom.record?.id ?? null,
      existingVersionId: existingVersion?.id ?? null,
      odooBomId: bom.bomOdooId,
    };

    // Validated below, once every package item is known: the builder's own
    // findings, the shared BOM validators and the dependency check together.
    const row = createImportRow('bomPackage', bom.sourceRow, payload, `bomPackage:${bom.bomKey || bom.sourceRow}`);
    staged.push({
      row,
      kind: 'bomPackage',
      rawRow: bom.raw,
      provenance: bom.provenance,
      deferral: null,
      upsertAction: existingBom.record ? 'UPDATE' : 'CREATE',
      matchedBy: existingBom.matchedBy,
      componentCount: components.length,
      baseIssues: { errors, warnings },
    });
  }

  const base = input.validationContext ?? {};
  const previewContext: ImportValidationContext = {
    ...base,
    products: [...(input.existing.products ?? base.products ?? []), ...pendingItems.products],
    materials: [...(input.existing.materials ?? base.materials ?? []), ...pendingItems.materials],
    boms: input.existing.boms ?? base.boms ?? [],
    bomVersions: input.existing.bomVersions ?? base.bomVersions ?? [],
  };
  const evaluated = evaluatePackageRows({ staged, previewContext, itemRowIds }, staged.map((s) => s.row));
  evaluated.forEach((row, i) => { staged[i] = { ...staged[i], row }; });

  const exceptions = input.exceptionSheets.flatMap((sheet) => readExceptionsSheet(sheet.rows));

  const counts = packageSessionCounts(staged, staged.map((s) => s.row), exceptions);
  counts.productSourceRows = productRows.length;

  return {
    importSessionId: input.importSessionId,
    staged,
    previewContext,
    itemRowIds,
    exceptions,
    counts,
    unresolvedUnits: [...unitProblems.entries()].map(([unit, rows]) => ({ unit, rows })).sort((a, b) => b.rows - a.rows),
    deferred: staged.filter((s) => s.deferral).map((s) => ({
      rowId: s.row.rowId,
      kind: s.kind,
      code: String((s.row.originalRowData as Record<string, unknown>).code ?? ''),
      name: String((s.row.originalRowData as Record<string, unknown>).name ?? ''),
      reason: s.deferral!.reason,
      detail: s.deferral!.detail,
      sourceFile: s.provenance.sourceFile,
      sourceRow: s.provenance.sourceRow,
    })),
  };
}

// ==================================================================================
// Evaluation - the preview's BOM status, by the same rules the write uses
// ==================================================================================

/** The dependency issue's field, so a count can tell "waits for an item" from bad data. */
export const PACKAGE_DEPENDENCY_FIELD = 'packageDependency';

/** One cache per preview context: the BOM validators are pure, so a payload is validated once. */
const bomValidationCache = new WeakMap<object, WeakMap<object, ImportValidationResult>>();

function validateBomPayload(context: ImportValidationContext, row: ImportRow): ImportValidationResult {
  let perContext = bomValidationCache.get(context);
  if (!perContext) {
    perContext = new WeakMap();
    bomValidationCache.set(context, perContext);
  }
  // A corrected row is a new payload; an untouched row reuses its frozen source object.
  const key = (row.correctedRowData ?? row.originalRowData) as object;
  const cached = perContext.get(key);
  if (cached) return cached;
  // The very function the execution's final revalidation calls.
  const result = resolveAndValidateImportRow('bomPackage', rowPayload(row), context, {});
  perContext.set(key, result);
  return result;
}

function whyNotWritten(row: ImportRow | undefined): { ar: string; en: string } {
  if (!row) return { ar: 'صفه غير موجود', en: 'its row is missing' };
  if (row.selection === 'SKIPPED') return { ar: 'صفه متخطى', en: 'its row is skipped' };
  if (row.selection === 'EXCLUDED') return { ar: 'صفه مستبعد', en: 'its row is excluded' };
  if (row.status === 'FAILED') return { ar: 'فشلت كتابته', en: 'its write failed' };
  if (row.errors.length > 0) return { ar: 'صفه به خطأ مانع', en: 'its row has a blocking error' };
  if (row.warnings.length > 0 && !row.warningsAccepted) return { ar: 'تحذيراته لم تُقبل بعد', en: 'its warnings are not accepted yet' };
  return { ar: 'لن يُكتب', en: 'it will not be written' };
}

function sameIssues(a: readonly ImportIssue[], b: readonly ImportIssue[]): boolean {
  return a.length === b.length && a.every((x, i) => x.field === b[i].field && x.messageEn === b[i].messageEn);
}

/**
 * The preview status of every BOM row, re-derived from the rows as they stand:
 *   1. the builder's own findings (a repeated BOM, a code that resolves to nothing);
 *   2. the SAME shared validator the execution runs before writing, over the
 *      in-memory context of existing items plus the package's items;
 *   3. the dependency rule - a BOM that points at a package item which will NOT
 *      be written is BLOCKING, with the item and the reason.
 * Rows already imported or failed are left as they are. A row whose outcome does
 * not change is returned as the same object, so re-running this is cheap and a
 * caller can tell nothing moved.
 */
export function evaluatePackageRows(
  result: Pick<PackageSessionResult, 'staged' | 'previewContext' | 'itemRowIds'>,
  rows: readonly ImportRow[],
): ImportRow[] {
  const byId = new Map(rows.map((r) => [r.rowId, r]));
  const stagedById = new Map(result.staged.map((s) => [s.row.rowId, s]));
  const displayCode = new Map<string, string>();
  for (const [token, rowId] of Object.entries(result.itemRowIds)) {
    displayCode.set(token, String((stagedById.get(rowId)?.row.originalRowData as Record<string, unknown> | undefined)?.code ?? token));
  }
  const writable = new Set<string>();
  for (const [token, rowId] of Object.entries(result.itemRowIds)) {
    const row = byId.get(rowId);
    if (row && (isRowWritable(row) || row.status === 'IMPORTED')) writable.add(token);
  }

  return rows.map((row) => {
    if (row.entityKind !== 'bomPackage' || row.status === 'IMPORTED' || row.status === 'FAILED') return row;
    const baseIssues = stagedById.get(row.rowId)?.baseIssues ?? { errors: [], warnings: [] };
    const validation = validateBomPayload(result.previewContext, row);

    const dependency: ImportIssue[] = [];
    for (const token of packageItemTokensOf(rowPayload(row))) {
      if (writable.has(token)) continue;
      const itemRowId = result.itemRowIds[token];
      const why = whyNotWritten(itemRowId ? byId.get(itemRowId) : undefined);
      const code = displayCode.get(token) ?? token;
      dependency.push(issue(PACKAGE_DEPENDENCY_FIELD,
        `تعتمد قائمة المواد على الصنف "${code}" من نفس الحزمة، ولن يُكتب لأن ${why.ar}. اقبل ذلك الصف أو صححه، أو استبعد هذه القائمة.`,
        `This BOM depends on item "${code}" from this package, which will not be written because ${why.en}. Accept or fix that row, or exclude this BOM.`));
    }

    // The builder already reports a code that resolves to nothing; the validator's
    // "select the item" for the same blank id would only repeat it.
    const baseFields = new Set(baseIssues.errors.map((e) => e.field));
    const repeatsBase = (e: ImportIssue) => {
      if (e.field === 'bom.itemId') return baseFields.has('productCode');
      const line = e.field === 'version.components.itemId' ? /^Line (\d+): select the item\.$/.exec(e.messageEn) : null;
      return line !== null && baseFields.has(`components.${line[1]}.itemId`);
    };
    const validatorErrors = validation.errors.filter((e) => !repeatsBase(e));
    const errors = [...baseIssues.errors, ...dependency, ...validatorErrors];
    const warnings = [...baseIssues.warnings, ...validation.warnings.filter((w) => !baseIssues.warnings.some((b) => b.messageEn === w.messageEn))];
    if (sameIssues(row.errors, errors) && sameIssues(row.warnings, warnings) && (errors.length > 0 || row.normalizedData)) return row;
    return applyValidation(row, { errors, warnings, normalized: errors.length ? null : validation.normalized ?? null });
  });
}

/**
 * The package counts, from the rows as they stand now - so the preview and the
 * approved import count the same thing. "Waiting for items" is a BOM whose only
 * problem is a package item that will not be written (for example, its warnings
 * are not accepted yet); "blocked by data" is a BOM with an error of its own.
 */
export function packageSessionCounts(
  staged: readonly Pick<PackageStagedRow, 'row' | 'kind' | 'deferral' | 'upsertAction' | 'componentCount'>[],
  rows: readonly ImportRow[],
  exceptions: readonly PackageException[] = [],
): Record<string, number> {
  const byId = new Map(rows.map((r) => [r.rowId, r]));
  const current = staged.map((s) => ({ ...s, row: byId.get(s.row.rowId) ?? s.row }));
  const of = (kind: PackageStagedRow['kind']) => current.filter((s) => s.kind === kind);
  const boms = of('bomPackage');
  const dataErrors = (r: ImportRow) => r.errors.some((e) => e.field !== PACKAGE_DEPENDENCY_FIELD);
  return {
    productSourceRows: of('products').length + of('materials').length,
    products: of('products').length,
    materials: of('materials').length,
    productsToCreate: of('products').filter((s) => s.upsertAction === 'CREATE').length,
    productsToUpdate: of('products').filter((s) => s.upsertAction === 'UPDATE').length,
    materialsToCreate: of('materials').filter((s) => s.upsertAction === 'CREATE').length,
    materialsToUpdate: of('materials').filter((s) => s.upsertAction === 'UPDATE').length,
    productsWillImport: of('products').filter((s) => isRowWritable(s.row)).length,
    materialsWillImport: of('materials').filter((s) => isRowWritable(s.row)).length,
    boms: boms.length,
    bomsToCreate: boms.filter((s) => s.upsertAction === 'CREATE').length,
    bomsToUpdate: boms.filter((s) => s.upsertAction === 'UPDATE').length,
    bomsValid: boms.filter((s) => s.row.errors.length === 0).length,
    bomsBlockedByData: boms.filter((s) => dataErrors(s.row)).length,
    bomsWaitingForItems: boms.filter((s) => s.row.errors.length > 0 && !dataErrors(s.row)).length,
    bomsWillImport: boms.filter((s) => isRowWritable(s.row)).length,
    bomComponents: current.reduce((n, s) => n + (s.componentCount ?? 0), 0),
    blocking: current.filter((s) => s.row.errors.length > 0).length,
    skippedDuplicates: current.filter((s) => s.deferral?.reason === 'DUPLICATE_CODE').length,
    deferredUnsupportedUom: current.filter((s) => s.deferral?.reason === 'UNSUPPORTED_UOM').length,
    warnings: current.filter((s) => s.row.warnings.length > 0).length,
    ready: current.filter((s) => s.row.errors.length === 0).length,
    willImport: current.filter((s) => isRowWritable(s.row)).length,
    exceptions: exceptions.length,
    blockingExceptions: exceptions.filter((e) => e.blocking).length,
  };
}

/** CREATE or UPDATE for one product / material row, using the package's own rule. */
function validateAgainstExisting(
  item: PackageProductRow,
  existing: readonly Stored[] | null | undefined,
): { errors: ImportIssue[]; warnings: ImportIssue[]; payload: Record<string, unknown> } {
  const checked = validateMasterDataPackageRow(item.kind, item.payload, existing);
  return { errors: checked.issues, warnings: checked.warnings, payload: checked.payload };
}

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
 */
import type { ImportRow } from './entityImportPure';
import { applyValidation, createImportRow, setRowSelection, type ImportIssue } from './entityImportPure';
import {
  PACKAGE_BOM_VERSION_CODE,
  findExistingBom,
  findExistingBomVersion,
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
}

export interface PackageSessionResult {
  importSessionId: string;
  staged: PackageStagedRow[];
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
  packageItems: Map<string, { itemSource: 'products' | 'materials'; itemId: string | null }>,
): { itemSource: 'products' | 'materials'; itemId: string | null } | null {
  const key = normalizeCode(code);
  if (!key) return null;
  const product = (products ?? []).find((p) => normalizeCode(String(p.code ?? '')) === key || normalizeCode(String(p.productCode ?? '')) === key);
  if (product) return { itemSource: 'products', itemId: String(product.id ?? '') };
  const material = (materials ?? []).find((m) => normalizeCode(String(m.code ?? '')) === key);
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

  /** Every item the package itself defines, so a BOM can point at an item created in the same run. */
  const packageItems = new Map<string, { itemSource: 'products' | 'materials'; itemId: string | null }>();

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
      packageItems.set(code, { itemSource: item.kind, itemId: null });
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

    const row = applyValidation(
      createImportRow('bomPackage', bom.sourceRow, payload, `bomPackage:${bom.bomKey || bom.sourceRow}`),
      { errors, warnings, normalized: errors.length ? null : payload },
    );
    staged.push({
      row,
      kind: 'bomPackage',
      rawRow: bom.raw,
      provenance: bom.provenance,
      deferral: null,
      upsertAction: existingBom.record ? 'UPDATE' : 'CREATE',
      matchedBy: existingBom.matchedBy,
      componentCount: components.length,
    });
  }

  const exceptions = input.exceptionSheets.flatMap((sheet) => readExceptionsSheet(sheet.rows));

  const counts: Record<string, number> = {
    productSourceRows: productRows.length,
    products: staged.filter((s) => s.kind === 'products').length,
    materials: staged.filter((s) => s.kind === 'materials').length,
    productsToCreate: staged.filter((s) => s.kind === 'products' && s.upsertAction === 'CREATE').length,
    productsToUpdate: staged.filter((s) => s.kind === 'products' && s.upsertAction === 'UPDATE').length,
    materialsToCreate: staged.filter((s) => s.kind === 'materials' && s.upsertAction === 'CREATE').length,
    materialsToUpdate: staged.filter((s) => s.kind === 'materials' && s.upsertAction === 'UPDATE').length,
    boms: staged.filter((s) => s.kind === 'bomPackage').length,
    bomsToCreate: staged.filter((s) => s.kind === 'bomPackage' && s.upsertAction === 'CREATE').length,
    bomsToUpdate: staged.filter((s) => s.kind === 'bomPackage' && s.upsertAction === 'UPDATE').length,
    bomComponents: staged.reduce((n, s) => n + (s.componentCount ?? 0), 0),
    blocking: staged.filter((s) => s.row.errors.length > 0).length,
    skippedDuplicates: staged.filter((s) => s.deferral?.reason === 'DUPLICATE_CODE').length,
    deferredUnsupportedUom: staged.filter((s) => s.deferral?.reason === 'UNSUPPORTED_UOM').length,
    warnings: staged.filter((s) => s.row.warnings.length > 0).length,
    ready: staged.filter((s) => s.row.errors.length === 0).length,
    exceptions: exceptions.length,
    blockingExceptions: exceptions.filter((e) => e.blocking).length,
  };

  return {
    importSessionId: input.importSessionId,
    staged,
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

/** CREATE or UPDATE for one product / material row, using the package's own rule. */
function validateAgainstExisting(
  item: PackageProductRow,
  existing: readonly Stored[] | null | undefined,
): { errors: ImportIssue[]; warnings: ImportIssue[]; payload: Record<string, unknown> } {
  const checked = validateMasterDataPackageRow(item.kind, item.payload, existing);
  return { errors: checked.issues, warnings: checked.warnings, payload: checked.payload };
}

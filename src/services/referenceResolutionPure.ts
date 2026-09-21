/**
 * Business-code resolution for imports - Phase 1 Step 8C-3. Pure and Firebase-free.
 *
 * A real file speaks the factory's language: product codes, customer codes, job
 * codes, batch numbers, BOM and version codes, operation and equipment codes, or
 * an Odoo identifier. This layer turns those into the ASFOUR document ids the
 * validators already expect - and nothing else changes: the document id stays the
 * technical identity, the business code stays a business identifier, and an Odoo
 * id stays an external reference (Step 1A).
 *
 * ORDER OF RESOLUTION, deterministic first:
 *   1 an internal id the file supplied on purpose
 *   2 the exact ASFOUR business code
 *   3 an exact external reference (system + model + external id, e.g. Odoo)
 *   4 a mapping already approved in this import session
 *   5 a fuzzy SUGGESTION - never applied, only offered for review
 *
 * WHAT IS NEVER GUESSED. One code matching several records is AMBIGUOUS; a code
 * duplicated in the master is DUPLICATE_BUSINESS_CODE; an unknown code is
 * NOT_FOUND. All three block the row until a person decides. A fuzzy candidate
 * is shown with its score and applied only when approved.
 *
 * CODES ARE COMPARED, NOT REWRITTEN. Comparison uses the existing
 * `normalizeCode` (trim, upper case, Arabic digits to Western, no inner spaces),
 * so "00125" never becomes "125" - a leading zero is part of the identifier.
 *
 * NESTED CELLS TOO. A BOM version's components, and a production row's
 * consumption lines and outputs, are resolved item by item and batch by batch,
 * so no nested object ever needs a document id.
 */
import { normalizeCode } from '../utils/searchUtils';
import { rankFuzzyCandidates } from '../utils/fuzzyMatching';
import { externalIdentityKey, readExternalReferences } from './externalReferencesPure';
import { resolveLogicalItemId } from './logicalItemPure';
import type { LogicalItemRecord } from './logicalItemPure';
import type { ImportEntityKind } from './entityImportPure';

type Stored = Record<string, any> & { id?: string };

export type ReferenceEntity =
  | 'product' | 'material' | 'item' | 'customer' | 'employee'
  | 'job' | 'batch' | 'bom' | 'bomVersion' | 'routing' | 'routingVersion'
  | 'operation' | 'equipment' | 'costCenter' | 'account' | 'logicalItem';

export type ResolutionMethod = 'INTERNAL_ID' | 'EXACT_CODE' | 'EXTERNAL_REFERENCE' | 'APPROVED_MAPPING' | 'FUZZY_SUGGESTION' | 'NONE';

export type ResolutionStatus = 'RESOLVED' | 'NOT_FOUND' | 'AMBIGUOUS_REFERENCE' | 'DUPLICATE_BUSINESS_CODE' | 'SUGGESTION_PENDING' | 'EMPTY';

export interface ReferenceCandidate {
  id: string;
  code: string;
  name: string;
  /** Only for a fuzzy suggestion. */
  score?: number;
}

export interface ReferenceResolution {
  /** The row field the value came from, including its path inside a nested cell. */
  field: string;
  /** The field the resolved id is written to. */
  targetField: string;
  entity: ReferenceEntity;
  sourceValue: string;
  method: ResolutionMethod;
  status: ResolutionStatus;
  targetId: string | null;
  targetCode: string | null;
  candidates: ReferenceCandidate[];
  messageAr: string;
  messageEn: string;
}

/**
 * The Excel column names accepted for each reference, explicitly - a bounded
 * list, never a generic parser. Compared case-insensitively, ignoring spaces
 * and underscores, so "Product Code", "product_code" and "productCode" are one.
 */
export const REFERENCE_FIELD_ALIASES: Readonly<Record<string, readonly string[]>> = {
  productCode: ['productCode', 'product code', 'product_code', 'كود المنتج'],
  materialCode: ['materialCode', 'material code', 'material_code', 'كود الخامة'],
  itemCode: ['itemCode', 'item code', 'item_code', 'كود الصنف'],
  customerCode: ['customerCode', 'customer code', 'customer_code', 'كود العميل'],
  employeeCode: ['employeeCode', 'employee code', 'employee_code', 'كود الموظف'],
  jobCode: ['jobCode', 'job code', 'job_code', 'رقم أمر الشغل'],
  parentJobCode: ['parentJobCode', 'parent job code', 'parent_job_code', 'mainJobCode', 'main job code', 'main_job_code', 'أمر الشغل الرئيسي'],
  batchNumber: ['batchNumber', 'batch number', 'batch_number', 'batchNo', 'رقم الدفعة'],
  bomCode: ['bomCode', 'bom code', 'bom_code', 'كود قائمة المواد'],
  bomVersionCode: ['bomVersionCode', 'bom version code', 'bom_version_code', 'versionCode', 'version code', 'version_code', 'version', 'رمز الإصدار'],
  routingCode: ['routingCode', 'routing code', 'routing_code', 'كود المسار'],
  routingVersionCode: ['routingVersionCode', 'routing version code', 'routing_version_code', 'رمز إصدار المسار'],
  operationCode: ['operationCode', 'operation code', 'operation_code', 'كود العملية'],
  equipmentCode: ['equipmentCode', 'equipment code', 'equipment_code', 'machineCode', 'machine code', 'كود المعدة'],
  pressCode: ['pressCode', 'press code', 'press_code'],
  furnaceCode: ['furnaceCode', 'furnace code', 'furnace_code'],
  rotaryKilnCode: ['rotaryKilnCode', 'rotary kiln code', 'rotary_kiln_code', 'kilnCode', 'kiln code'],
  millCode: ['millCode', 'mill code', 'mill_code'],
  tubeBallMillCode: ['tubeBallMillCode', 'tube ball mill code', 'tube_ball_mill_code'],
  bunkerCode: ['bunkerCode', 'bunker code', 'bunker_code', 'bunkerNumber', 'bunker number'],
  costCenterCode: ['costCenterCode', 'cost center code', 'cost_center_code', 'costCentreCode', 'كود مركز التكلفة'],
  accountCode: ['accountCode', 'account code', 'account_code', 'كود الحساب'],
  externalSystem: ['externalSystem', 'external system', 'external_system', 'system'],
  externalModel: ['externalModel', 'external model', 'external_model', 'model'],
  externalId: ['externalId', 'external id', 'external_id', 'odooId', 'odoo id', 'odoo_id'],
};

const aliasKey = (key: string) => key.trim().toLowerCase().replace(/[\s_]+/g, '');

/** The value of one canonical reference field on a row, whatever column name the file used. */
export function readReferenceValue(row: Record<string, unknown>, canonicalField: string): unknown {
  const aliases = REFERENCE_FIELD_ALIASES[canonicalField] ?? [canonicalField];
  const wanted = new Set(aliases.map(aliasKey));
  for (const [key, value] of Object.entries(row)) {
    if (wanted.has(aliasKey(key))) return value;
  }
  return undefined;
}

const text = (value: unknown) => (typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim());

export interface ReferenceIndex {
  entity: ReferenceEntity;
  records: readonly Stored[];
  /** normalised business code -> records carrying it (more than one = a duplicate in the master). */
  byCode: Map<string, Stored[]>;
  byId: Map<string, Stored>;
  /** external identity key -> records. */
  byExternal: Map<string, Stored[]>;
  codeField: string;
  nameField: string;
}

/** Builds the in-memory dictionaries one import session uses - no query per cell. */
export function buildReferenceIndex(entity: ReferenceEntity, records: readonly Stored[] | null | undefined, options: { codeFields?: readonly string[]; nameField?: string } = {}): ReferenceIndex {
  const codeFields = options.codeFields ?? ['code'];
  const list = records ?? [];
  const byCode = new Map<string, Stored[]>();
  const byId = new Map<string, Stored>();
  const byExternal = new Map<string, Stored[]>();
  for (const record of list) {
    const id = String(record.id ?? '');
    if (id) byId.set(id, record);
    for (const field of codeFields) {
      const code = normalizeCode(record[field]);
      if (!code) continue;
      byCode.set(code, [...(byCode.get(code) ?? []), record]);
    }
    for (const ref of readExternalReferences(record)) {
      const key = externalIdentityKey(ref);
      if (key) byExternal.set(key, [...(byExternal.get(key) ?? []), record]);
    }
  }
  return { entity, records: list, byCode, byId, byExternal, codeField: codeFields[0], nameField: options.nameField ?? 'name' };
}

/** A mapping approved during this import session: reused for every later row that names it. */
export type ReferenceMappingCache = Map<string, { targetId: string; method: ResolutionMethod }>;

export const cacheKey = (entity: ReferenceEntity, sourceValue: string) => `${entity}|${normalizeCode(sourceValue)}`;

/** Records an approved mapping so the next 499 rows naming the same code reuse it. */
export function approveReferenceMapping(cache: ReferenceMappingCache, entity: ReferenceEntity, sourceValue: string, targetId: string, method: ResolutionMethod = 'APPROVED_MAPPING'): ReferenceMappingCache {
  const next = new Map(cache);
  next.set(cacheKey(entity, sourceValue), { targetId, method });
  return next;
}

const candidate = (index: ReferenceIndex, record: Stored, score?: number): ReferenceCandidate => ({
  id: String(record.id ?? ''),
  code: text(record[index.codeField]),
  name: text(record[index.nameField] ?? record.nameAr ?? record.batchNumber),
  ...(score === undefined ? {} : { score }),
});

export interface ResolveOptions {
  /** The record's own external reference, when the row carries one. */
  external?: { system?: unknown; model?: unknown; externalId?: unknown };
  /** Narrows the candidates before deciding (e.g. batches of this job). */
  narrow?: (record: Stored) => boolean;
  /** Approved mappings for this import session. */
  cache?: ReferenceMappingCache;
  /** Offer fuzzy candidates when nothing matched exactly. Never applied automatically. */
  suggest?: boolean;
}

/**
 * Resolves ONE business value to one record. Deterministic first; a fuzzy match
 * is only ever a suggestion.
 */
export function resolveReference(
  index: ReferenceIndex,
  field: string,
  targetField: string,
  value: unknown,
  options: ResolveOptions = {},
): ReferenceResolution {
  const sourceValue = text(value);
  const base = { field, targetField, entity: index.entity, sourceValue, candidates: [] as ReferenceCandidate[] };
  const done = (status: ResolutionStatus, method: ResolutionMethod, record: Stored | null, messageAr: string, messageEn: string, candidates: ReferenceCandidate[] = []): ReferenceResolution => ({
    ...base,
    status,
    method,
    targetId: record ? String(record.id ?? '') : null,
    targetCode: record ? text(record[index.codeField]) : null,
    candidates,
    messageAr,
    messageEn,
  });

  if (!sourceValue) return done('EMPTY', 'NONE', null, '', '');

  // 1. An internal id the file supplied on purpose - still supported.
  const byId = index.byId.get(sourceValue);
  if (byId && (!options.narrow || options.narrow(byId))) {
    return done('RESOLVED', 'INTERNAL_ID', byId, 'تم التعرف على المعرف الداخلي.', 'Matched the internal document id.');
  }

  // 2. A mapping approved earlier in this same import session.
  const cached = options.cache?.get(cacheKey(index.entity, sourceValue));
  if (cached) {
    const record = index.byId.get(cached.targetId);
    if (record) return done('RESOLVED', 'APPROVED_MAPPING', record, 'تم استخدام ربط معتمد في هذا الاستيراد.', 'Used a mapping approved earlier in this import.');
  }

  // 3. The exact business code.
  const code = normalizeCode(sourceValue);
  const byCode = (index.byCode.get(code) ?? []).filter((r) => !options.narrow || options.narrow(r));
  if (byCode.length === 1) {
    return done('RESOLVED', 'EXACT_CODE', byCode[0], 'مطابقة كود تامة.', 'Exact business code match.');
  }
  if (byCode.length > 1) {
    return done('DUPLICATE_BUSINESS_CODE', 'EXACT_CODE', null,
      `الكود "${sourceValue}" مكرر في البيانات الأساسية (${byCode.length}) - يلزم اختيار السجل الصحيح.`,
      `Business code "${sourceValue}" is duplicated in the master data (${byCode.length}) - the right record must be chosen.`,
      byCode.map((r) => candidate(index, r)));
  }

  // 4. An exact external reference (Step 1A), e.g. an Odoo id.
  const ext = options.external;
  if (ext && text(ext.externalId)) {
    const key = externalIdentityKey({ system: text(ext.system).toLowerCase(), model: text(ext.model), externalId: text(ext.externalId) } as never);
    const matches = key ? (index.byExternal.get(key) ?? []).filter((r) => !options.narrow || options.narrow(r)) : [];
    if (matches.length === 1) return done('RESOLVED', 'EXTERNAL_REFERENCE', matches[0], 'مطابقة مرجع خارجي.', 'Matched an external reference.');
    if (matches.length > 1) {
      return done('AMBIGUOUS_REFERENCE', 'EXTERNAL_REFERENCE', null, 'المرجع الخارجي يطابق أكثر من سجل.', 'The external reference matches more than one record.', matches.map((r) => candidate(index, r)));
    }
  }

  // 5. A suggestion only - never applied.
  if (options.suggest) {
    const pool = index.records.filter((r) => !options.narrow || options.narrow(r));
    // The existing ranker, with this index's own code and name fields.
    const ranked = rankFuzzyCandidates<Stored>(sourceValue, pool as Stored[], {
      extractCode: (r) => String(r[index.codeField] ?? ''),
      extractName: (r) => String(r[index.nameField] ?? ''),
      maxResults: 5,
    });
    const candidates = ranked.map((c) => candidate(index, c.entity, c.confidence));
    if (candidates.length > 0) {
      return done('SUGGESTION_PENDING', 'FUZZY_SUGGESTION', null,
        `لا يوجد تطابق تام لـ "${sourceValue}" - توجد اقتراحات تحتاج اعتمادًا يدويًا.`,
        `No exact match for "${sourceValue}" - suggestions are offered and must be approved manually.`,
        candidates);
    }
  }

  return done('NOT_FOUND', 'NONE', null,
    `لا يوجد سجل بالكود "${sourceValue}".`,
    `No record matches "${sourceValue}".`);
}

// --- Row level ------------------------------------------------------------------------------

export interface ReferenceIndexes {
  product?: ReferenceIndex;
  material?: ReferenceIndex;
  customer?: ReferenceIndex;
  employee?: ReferenceIndex;
  job?: ReferenceIndex;
  batch?: ReferenceIndex;
  bom?: ReferenceIndex;
  bomVersion?: ReferenceIndex;
  routing?: ReferenceIndex;
  routingVersion?: ReferenceIndex;
  operation?: ReferenceIndex;
  equipment?: ReferenceIndex;
  costCenter?: ReferenceIndex;
  account?: ReferenceIndex;
  logicalItems?: readonly LogicalItemRecord[] | null;
}

/** One equipment code field per stage equipment field, from the registry's own field names. */
const EQUIPMENT_FIELDS: ReadonlyArray<{ alias: string; target: string }> = [
  { alias: 'pressCode', target: 'pressId' },
  { alias: 'furnaceCode', target: 'furnaceId' },
  { alias: 'rotaryKilnCode', target: 'rotaryKilnId' },
  { alias: 'millCode', target: 'millId' },
  { alias: 'tubeBallMillCode', target: 'tubeBallMillId' },
  { alias: 'bunkerCode', target: 'bunkerId' },
  { alias: 'equipmentCode', target: 'equipmentId' },
];

export interface RowResolution {
  /** The row with every resolved id written into its own field. Never mutates the input. */
  payload: Record<string, unknown>;
  resolutions: ReferenceResolution[];
}

const isBlocking = (r: ReferenceResolution) => r.status === 'NOT_FOUND' || r.status === 'AMBIGUOUS_REFERENCE' || r.status === 'DUPLICATE_BUSINESS_CODE' || r.status === 'SUGGESTION_PENDING';

/** The issues a resolution list adds to a row - a reference that is not resolved blocks it. */
export function resolutionIssues(resolutions: readonly ReferenceResolution[]): { errors: Array<{ field: string; messageAr: string; messageEn: string }>; warnings: Array<{ field: string; messageAr: string; messageEn: string }> } {
  return {
    errors: resolutions.filter(isBlocking).map((r) => ({ field: r.field, messageAr: `${r.field}: ${r.messageAr}`, messageEn: `${r.field}: ${r.messageEn}` })),
    warnings: [],
  };
}

function resolveItem(indexes: ReferenceIndexes, field: string, targetField: string, value: unknown, itemSource: string, options: ResolveOptions): ReferenceResolution | null {
  const index = itemSource === 'products' ? indexes.product : indexes.material;
  if (!index) return null;
  return resolveReference(index, field, targetField, value, options);
}

/**
 * Resolves every business identifier on one row - including the ones inside its
 * nested component, consumption and output cells - and returns the row with ids
 * filled in. A row that already carries ids is untouched.
 */
export function resolveRowReferences(
  kind: ImportEntityKind,
  row: Record<string, unknown>,
  indexes: ReferenceIndexes,
  options: { cache?: ReferenceMappingCache; suggest?: boolean } = {},
): RowResolution {
  const payload: Record<string, unknown> = { ...row };
  const resolutions: ReferenceResolution[] = [];
  const cache = options.cache;
  const suggest = options.suggest ?? true;

  const take = (canonical: string) => readReferenceValue(row, canonical);
  const apply = (resolution: ReferenceResolution | null) => {
    if (!resolution || resolution.status === 'EMPTY') return;
    resolutions.push(resolution);
    if (resolution.status === 'RESOLVED' && resolution.targetId) payload[resolution.targetField] = resolution.targetId;
  };
  const external = { system: take('externalSystem'), model: take('externalModel'), externalId: take('externalId') };

  // Product / customer / employee, on any row that names them.
  if (indexes.product && !text(payload.productId)) apply(resolveReference(indexes.product, 'productCode', 'productId', take('productCode'), { cache, suggest, external }));
  if (indexes.customer && !text(payload.customerId)) apply(resolveReference(indexes.customer, 'customerCode', 'customerId', take('customerCode'), { cache, suggest, external }));
  if (indexes.employee && !text(payload.employeeId)) apply(resolveReference(indexes.employee, 'employeeCode', 'employeeId', take('employeeCode'), { cache, suggest }));
  if (indexes.costCenter && !text(payload.hierarchyNodeId)) apply(resolveReference(indexes.costCenter, 'costCenterCode', 'hierarchyNodeId', take('costCenterCode'), { cache, suggest: false }));
  if (indexes.account && !text(payload.accountCode)) apply(resolveReference(indexes.account, 'accountCode', 'accountCode', take('accountCode'), { cache, suggest: false }));

  // The job, then the batch in that job's context.
  if (indexes.job && !text(payload.jobReferenceId)) apply(resolveReference(indexes.job, 'jobCode', 'jobReferenceId', take('jobCode'), { cache, suggest, external }));
  if (indexes.job && !text(payload.parentJobReferenceId)) apply(resolveReference(indexes.job, 'parentJobCode', 'parentJobReferenceId', take('parentJobCode'), { cache, suggest }));
  const jobId = text(payload.jobReferenceId);
  const batchNarrow = jobId ? (b: Stored) => !text(b.jobReferenceId) || text(b.jobReferenceId) === jobId : undefined;
  if (indexes.batch && kind !== 'batches' && !text(payload.batchId)) {
    apply(resolveReference(indexes.batch, 'batchNumber', 'batchId', take('batchNumber'), { cache, suggest: false, narrow: batchNarrow }));
  }

  // BOM, routing and their versions.
  if (indexes.bom && !text(payload.bomId)) apply(resolveReference(indexes.bom, 'bomCode', 'bomId', take('bomCode'), { cache, suggest }));
  if (indexes.routing && !text(payload.routingId)) apply(resolveReference(indexes.routing, 'routingCode', 'routingId', take('routingCode'), { cache, suggest }));
  const bomId = text(payload.bomId);
  if (indexes.bomVersion && !text(payload.bomVersionId) && take('bomVersionCode') !== undefined && kind !== 'bomVersions') {
    apply(resolveReference(indexes.bomVersion, 'bomVersionCode', 'bomVersionId', take('bomVersionCode'), { cache, suggest: false, narrow: bomId ? (v: Stored) => text(v.bomId) === bomId : undefined }));
  }
  const routingId = text(payload.routingId);
  if (indexes.routingVersion && !text(payload.routingVersionId) && take('routingVersionCode') !== undefined && kind !== 'routingVersions') {
    apply(resolveReference(indexes.routingVersion, 'routingVersionCode', 'routingVersionId', take('routingVersionCode'), { cache, suggest: false, narrow: routingId ? (v: Stored) => text(v.routingId) === routingId : undefined }));
  }

  // The item a BOM or routing is for: a product or material code, through the logical item where one is needed.
  if (kind === 'boms' && !text(payload.itemId)) {
    const source = text(payload.itemSource) || 'products';
    apply(resolveItem(indexes, 'itemCode', 'itemId', take('itemCode'), source, { cache, suggest }));
  }
  if (kind === 'routings' && !text(payload.logicalItemId)) {
    const source = text(payload.itemSource) || 'products';
    const itemResolution = resolveItem(indexes, 'itemCode', 'itemId', take('itemCode'), source, { cache, suggest });
    if (itemResolution && itemResolution.status !== 'EMPTY') {
      resolutions.push(itemResolution);
      if (itemResolution.status === 'RESOLVED' && itemResolution.targetId) {
        const key = resolveLogicalItemId(indexes.logicalItems ?? [], source, itemResolution.targetId);
        if (key.startsWith('logicalItem:')) payload.logicalItemId = key.slice('logicalItem:'.length);
        else {
          resolutions.push({
            ...itemResolution,
            field: 'itemCode',
            targetField: 'logicalItemId',
            entity: 'logicalItem',
            status: 'NOT_FOUND',
            targetId: null,
            messageAr: `الصنف "${itemResolution.targetCode}" ليس له صنف منطقي نشط - المسار يحتاج صنفًا منطقيًا.`,
            messageEn: `Item "${itemResolution.targetCode}" has no active logical item - a routing needs one.`,
          });
        }
      }
    }
  }

  // Operation and equipment.
  if (indexes.operation && !text(payload.operationId)) apply(resolveReference(indexes.operation, 'operationCode', 'operationId', take('operationCode'), { cache, suggest }));
  if (indexes.equipment) {
    for (const { alias, target } of EQUIPMENT_FIELDS) {
      if (text(payload[target])) continue;
      const value = take(alias);
      if (value === undefined || text(value) === '') continue;
      apply(resolveReference(indexes.equipment, alias, target, value, { cache, suggest }));
    }
  }

  // --- Nested cells: components, consumption lines and outputs ---------------------------------
  const resolveLines = (arrayField: string, itemTarget: string, defaultSource: string) => {
    const lines = Array.isArray(payload[arrayField]) ? (payload[arrayField] as Array<Record<string, unknown>>) : null;
    if (!lines) return;
    payload[arrayField] = lines.map((line, i) => {
      const next: Record<string, unknown> = { ...line };
      const source = text(line.itemSource) || defaultSource;
      if (!text(next[itemTarget])) {
        const value = readReferenceValue(line, 'itemCode') ?? readReferenceValue(line, 'materialCode') ?? readReferenceValue(line, 'productCode');
        const resolution = resolveItem(indexes, `${arrayField}.${i + 1}.itemCode`, itemTarget, value, source, { cache, suggest });
        if (resolution && resolution.status !== 'EMPTY') {
          resolutions.push(resolution);
          if (resolution.status === 'RESOLVED' && resolution.targetId) {
            next[itemTarget] = resolution.targetId;
            next.itemSource = source;
          }
        }
      }
      if (indexes.batch && !text(next.batchId)) {
        const batchValue = readReferenceValue(line, 'batchNumber');
        if (batchValue !== undefined && text(batchValue) !== '') {
          const resolution = resolveReference(indexes.batch, `${arrayField}.${i + 1}.batchNumber`, 'batchId', batchValue, { cache, suggest: false, narrow: batchNarrow });
          resolutions.push(resolution);
          if (resolution.status === 'RESOLVED' && resolution.targetId) next.batchId = resolution.targetId;
        }
      }
      return next;
    });
  };
  resolveLines('components', 'itemId', 'materials');
  resolveLines('materials', 'materialId', 'materials');
  resolveLines('productionOutputs', 'itemId', 'products');

  // Routing steps: operation and equipment per step.
  const steps = Array.isArray(payload.steps) ? (payload.steps as Array<Record<string, unknown>>) : null;
  if (steps && indexes.operation) {
    payload.steps = steps.map((step, i) => {
      const next: Record<string, unknown> = { ...step };
      if (!text(next.operationId)) {
        const resolution = resolveReference(indexes.operation!, `steps.${i + 1}.operationCode`, 'operationId', readReferenceValue(step, 'operationCode'), { cache, suggest });
        if (resolution.status !== 'EMPTY') {
          resolutions.push(resolution);
          if (resolution.status === 'RESOLVED' && resolution.targetId) next.operationId = resolution.targetId;
        }
      }
      if (indexes.equipment && !text(next.equipmentId)) {
        const value = readReferenceValue(step, 'equipmentCode');
        if (value !== undefined && text(value) !== '') {
          const resolution = resolveReference(indexes.equipment, `steps.${i + 1}.equipmentCode`, 'equipmentId', value, { cache, suggest });
          resolutions.push(resolution);
          if (resolution.status === 'RESOLVED' && resolution.targetId) next.equipmentId = resolution.targetId;
        }
      }
      return next;
    });
  }

  return { payload, resolutions };
}

/** The lists an import session resolves against, as loaded master data. */
export interface ReferenceSources {
  products?: readonly Stored[] | null;
  materials?: readonly Stored[] | null;
  customers?: readonly Stored[] | null;
  employees?: readonly Stored[] | null;
  jobReferences?: readonly Stored[] | null;
  batches?: readonly Stored[] | null;
  boms?: readonly Stored[] | null;
  bomVersions?: readonly Stored[] | null;
  routings?: readonly Stored[] | null;
  routingVersions?: readonly Stored[] | null;
  operations?: readonly Stored[] | null;
  equipment?: readonly Stored[] | null;
  costCenters?: readonly Stored[] | null;
  accounts?: readonly Stored[] | null;
  logicalItems?: readonly LogicalItemRecord[] | null;
}

/**
 * Builds every dictionary ONCE per import session, from data already loaded -
 * so five hundred rows naming the same code cost one lookup each, not one read.
 * Each index uses that master's own real code field.
 */
export function buildReferenceIndexes(sources: ReferenceSources): ReferenceIndexes {
  return {
    product: buildReferenceIndex('product', sources.products, { codeFields: ['code', 'productCode'] }),
    material: buildReferenceIndex('material', sources.materials, { codeFields: ['code'] }),
    customer: buildReferenceIndex('customer', sources.customers, { codeFields: ['code'] }),
    employee: buildReferenceIndex('employee', sources.employees, { codeFields: ['code', 'employeeCode'] }),
    job: buildReferenceIndex('job', sources.jobReferences, { codeFields: ['code'] }),
    batch: buildReferenceIndex('batch', sources.batches, { codeFields: ['batchNumber'], nameField: 'batchNumber' }),
    bom: buildReferenceIndex('bom', sources.boms, { codeFields: ['code'] }),
    bomVersion: buildReferenceIndex('bomVersion', sources.bomVersions, { codeFields: ['versionCode'], nameField: 'versionCode' }),
    routing: buildReferenceIndex('routing', sources.routings, { codeFields: ['code'] }),
    routingVersion: buildReferenceIndex('routingVersion', sources.routingVersions, { codeFields: ['versionCode'], nameField: 'versionCode' }),
    operation: buildReferenceIndex('operation', sources.operations, { codeFields: ['code'], nameField: 'nameAr' }),
    equipment: buildReferenceIndex('equipment', sources.equipment, { codeFields: ['code', 'bunkerNumber'] }),
    // The cost-centre hierarchy stores its code as sheet1Code; an account's identity is its code.
    costCenter: buildReferenceIndex('costCenter', sources.costCenters, { codeFields: ['sheet1Code', 'code'], nameField: 'nameAr' }),
    account: buildReferenceIndex('account', sources.accounts, { codeFields: ['code'] }),
    logicalItems: sources.logicalItems ?? null,
  };
}

/** One audit line per resolved reference, for the existing import audit. */
export function describeResolution(resolution: ReferenceResolution): string {
  const target = resolution.targetId ? `${resolution.targetCode ?? '-'} (${resolution.targetId})` : '-';
  return `${resolution.field}="${resolution.sourceValue}" ${resolution.entity} ${resolution.method} ${resolution.status} -> ${target}`;
}

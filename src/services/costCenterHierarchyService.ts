/**
 * ASFOUR ERP - Cost Center / Department Hierarchy Phase 2 service.
 *
 * Thin Firebase-aware wrapper around the pure parsing engine
 * (costCenterHierarchyPure.ts). Parsing an uploaded Sheet1 workbook is
 * entirely client-side and NEVER touches Firestore.
 *
 * ARCHITECTURE DECISION (Phase 2, reported explicitly rather than decided
 * silently, per the task's own instruction): this hierarchy is stored in a
 * NEW collection, `costCenterHierarchy`, never in the existing
 * `departments` collection. Reason: `MasterDataView.tsx` already fetches
 * every `departments` document to populate the Employee-assignment
 * department picker (see its own "Load auxiliary lists (departments &
 * furnaces for dropdowns)" comment) - injecting 189 hierarchy nodes,
 * including equipment leaves like "مكبس لايس 1600", into that same
 * collection would immediately corrupt that existing dropdown with
 * hundreds of non-department entries. This is a concrete, code-verified
 * regression risk, not a style preference, so a new collection is the
 * required (not merely preferred) choice.
 *
 * PHASE BOUNDARY: `createCostCenterHierarchyNodes` below is a Phase 3
 * function - fully implemented (so the eventual Firestore write shape is
 * concrete and reviewable now) but NEVER CALLED anywhere in this codebase
 * yet. No UI button, no page-load path, no test invokes it. It exists so a
 * future "Confirm & Create" action has a ready implementation to wire up.
 */
import * as XLSX from 'xlsx';
import { doc, writeBatch } from 'firebase/firestore';
import { db, auth } from '../config/firebase';
import { safeBatchSet, safeUpdateDoc } from '../utils/firestoreSanitizer';
import { logAuditAction } from './auditService';
import { invalidateCachedCollection } from './localCacheStore';
import {
  HierarchyIndex,
  HierarchyIssue,
  buildHierarchyIndex,
  validateNodeEdit,
} from './hierarchyResolverPure';
import { parseSheet1HierarchyRows, buildCostCenterHierarchyCreationPlan, ParsedHierarchyNode } from './costCenterHierarchyPure';
import { fetchMasterData } from './masterDataService';

/** NEW collection - never the existing `departments` collection. See the architecture decision above. Registered in firestore.rules (read: signed-in, write: admin). */
export const COST_CENTER_HIERARCHY_COLLECTION = 'costCenterHierarchy';

/**
 * Parses an uploaded Sheet1 workbook (as an ArrayBuffer, e.g. from a file
 * input) into the full classified node set. Throws a clear bilingual error
 * if the workbook has no worksheet literally named "Sheet1" - never falls
 * back to a different sheet, per the strict Sheet1-only source rule.
 */
export function parseSheet1Workbook(fileBuffer: ArrayBuffer): ParsedHierarchyNode[] {
  const workbook = XLSX.read(fileBuffer, { type: 'array' });
  if (!workbook.SheetNames.includes('Sheet1')) {
    throw new Error(
      `الملف المرفوع لا يحتوي على ورقة عمل باسم "Sheet1" (يحتوي فقط: ${workbook.SheetNames.join(', ')}) - هذا المصدر الوحيد المعتمد للتسلسل الهرمي الجديد. / The uploaded file has no worksheet literally named "Sheet1" (only: ${workbook.SheetNames.join(', ')}) - this is the only authoritative source for the new hierarchy.`
    );
  }
  const worksheet = workbook.Sheets['Sheet1'];
  const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' }) as unknown[][];
  return parseSheet1HierarchyRows(rows);
}

/**
 * PHASE 3/4A - fully implemented, NEVER CALLED anywhere (confirmed: grep
 * this codebase for `createCostCenterHierarchyNodes(` and the only match is
 * this definition - see costCenterHierarchy.test.ts §26 for an automated
 * source-inspection proof that the review UI never invokes it).
 *
 * PHASE 4A ID-STRATEGY FIX: the Firestore document ID for each node is now
 * the node's own `sheet1Code` (`doc(db, COST_CENTER_HIERARCHY_COLLECTION,
 * node.sheet1Code)`), NOT an auto-generated random ID as in the original
 * Phase 2/3 draft. This makes the whole operation idempotent by
 * construction: the SAME Sheet1 code always resolves to the SAME document,
 * so re-running this function - whether a deliberate re-import or a retry
 * after a partial failure - safely overwrites each node's document with
 * freshly-derived data (`safeBatchSet` performs a full, non-merging
 * `batch.set()`) rather than ever creating a second, duplicate document for
 * the same logical code. It also removes the need for a pre-generated
 * docId Map: `parentId` can simply equal `parentSheet1Code`, since that IS
 * the parent's real document ID under this scheme. No Firestore read of
 * any kind (no existence check, no collection scan) is needed to guarantee
 * this - determinism is the guard, not a query.
 *
 * Reuses `buildCostCenterHierarchyCreationPlan` (costCenterHierarchyPure.ts)
 * for the pure candidate -> plan mapping rather than duplicating it here -
 * this function's only remaining job is turning that already-built plan
 * into actual chunked Firestore writes plus the write-time-only fields
 * (`id`, `createdBy`, `createdByName`, `createdAt`) that cannot be pure.
 */
export async function createCostCenterHierarchyNodes(
  nodes: ParsedHierarchyNode[],
  onProgress?: (percent: number) => void
): Promise<{ createdCount: number; importId: string }> {
  const importId = `HIST-IMP-CCH-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const plan = buildCostCenterHierarchyCreationPlan(nodes, importId);
  const currentUser = auth.currentUser;
  const BATCH_SIZE = 400;

  let createdCount = 0;
  for (let i = 0; i < plan.length; i += BATCH_SIZE) {
    const chunk = plan.slice(i, i + BATCH_SIZE);
    const batch = writeBatch(db);

    chunk.forEach((planNode) => {
      // Deterministic ID = sheet1Code - see the function docblock above.
      const docRef = doc(db, COST_CENTER_HIERARCHY_COLLECTION, planNode.sheet1Code);
      safeBatchSet(batch, docRef, {
        id: planNode.sheet1Code,
        sheet1Code: planNode.sheet1Code,
        code: planNode.code,
        name: planNode.name,
        parentId: planNode.parentSheet1Code,
        parentSheet1Code: planNode.parentSheet1Code,
        level: planNode.level,
        type: planNode.type,
        rootCategoryCode: planNode.rootCategoryCode,
        rootCategoryName: planNode.rootCategoryName,
        status: planNode.status,
        notes: planNode.notes && planNode.notes.length > 0 ? planNode.notes : null,
        active: planNode.active,
        importBatchId: planNode.importBatchId,
        createdBy: currentUser?.uid || 'SUPER_ADMIN',
        createdByName: currentUser?.email || 'مشرف',
        createdAt: new Date().toISOString(),
      });
    });

    await batch.commit();
    createdCount += chunk.length;
    if (onProgress) onProgress(Math.round(((i + chunk.length) / plan.length) * 100));
  }

  return { createdCount, importId };
}

/**
 * A hierarchy node as persisted by createCostCenterHierarchyNodes below.
 * Mirrors the document written there, field for field.
 */
export interface CostCenterHierarchyRecord {
  id: string;
  sheet1Code: string;
  code: string;
  name: string;
  parentId: string | null;
  parentSheet1Code: string | null;
  level: number;
  type: string;
  rootCategoryCode: string;
  rootCategoryName: string;
  status: string;
  notes: string | null;
  active: boolean;
  importBatchId: string;
  createdBy: string;
  createdByName: string;
  createdAt: string;
}

/**
 * Reads the persisted hierarchy.
 *
 * This collection was previously WRITE-ONLY: the importer created documents
 * successfully, but nothing in the application ever read them back - there was
 * no list function here, no getDocs anywhere against this collection, and it is
 * absent from MASTER_DATA_COLLECTIONS. So a successful import reported a real
 * created count and then appeared to vanish. The records were never lost; they
 * simply had no reader.
 *
 * Goes through fetchMasterData so it inherits the released cache-first read,
 * per-user cache scoping and in-flight de-duplication rather than adding a new
 * Firestore access path in the UI.
 */
export async function listCostCenterHierarchyNodes(
  options?: { skipCache?: boolean },
): Promise<CostCenterHierarchyRecord[]> {
  return fetchMasterData<CostCenterHierarchyRecord>(COST_CENTER_HIERARCHY_COLLECTION, options);
}

/**
 * The persisted hierarchy as a resolver index.
 *
 * `parentSheet1Code` is the parent link and `sheet1Code` is both the code and
 * the Firestore document id, so a node's id IS its code here - which is why
 * selections in this category can be expressed as codes throughout.
 *
 * Uses the shared resolver; there is no descendant walk in this file.
 */
export function buildCostCenterHierarchyIndex(
  nodes: readonly CostCenterHierarchyRecord[],
): HierarchyIndex {
  return buildHierarchyIndex(
    nodes.map((node) => ({
      ...node,
      id: node.sheet1Code || node.id,
      code: node.sheet1Code || node.code,
      parentId: node.parentSheet1Code ?? null,
    })),
  );
}

/** Fields a hierarchy node exposes for editing. Everything else is import-derived and left alone. */
export interface CostCenterHierarchyNodePatch {
  name?: string;
  parentSheet1Code?: string | null;
  active?: boolean;
  notes?: string | null;
}

export interface HierarchyEditCheck {
  valid: boolean;
  issues: HierarchyIssue[];
}

/**
 * Pre-save structural check for one node edit.
 *
 * `sheet1Code` is deliberately NOT editable. It is the Firestore document id,
 * every child stores it as `parentSheet1Code`, and the importer's idempotency
 * depends on the same source code always resolving to the same document -
 * changing it would mean creating a new document and orphaning the branch
 * beneath it. Re-parenting is the supported way to restructure, and it is
 * checked here for self-parenting, unknown parents and cycles through the
 * shared resolver.
 */
export function validateHierarchyNodeEdit(
  nodes: readonly CostCenterHierarchyRecord[],
  sheet1Code: string,
  patch: CostCenterHierarchyNodePatch,
): HierarchyEditCheck {
  const index = buildCostCenterHierarchyIndex(nodes);
  const result = validateNodeEdit(
    index,
    sheet1Code,
    {
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.parentSheet1Code !== undefined ? { parentId: patch.parentSheet1Code } : {}),
    },
    { requireUniqueCode: false },
  );
  return { valid: result.valid, issues: result.issues };
}

/**
 * Writes one node edit.
 *
 * Mirrors what the Master Data single-record path already guarantees: the
 * structural check runs first, the write is a partial update (import-derived
 * fields such as level, type, rootCategory* and importBatchId are never
 * touched), the shared cache entry for this collection is invalidated so the
 * next read reflects the move, and an audit entry records the old and new
 * values with the user and reason.
 *
 * No production record is rewritten. Moving a node changes today's reporting
 * relationship; historical quantities are never edited to match.
 */
export async function updateCostCenterHierarchyNode(
  nodes: readonly CostCenterHierarchyRecord[],
  sheet1Code: string,
  patch: CostCenterHierarchyNodePatch,
  reason = 'تعديل التسلسل الهرمي',
): Promise<void> {
  const check = validateHierarchyNodeEdit(nodes, sheet1Code, patch);
  if (!check.valid) {
    throw new Error(check.issues.map((i) => `${i.messageAr} / ${i.messageEn}`).join(' | '));
  }

  const before = nodes.find((n) => n.sheet1Code === sheet1Code);
  const updates: Record<string, any> = { updatedAt: new Date().toISOString() };
  if (patch.name !== undefined) updates.name = String(patch.name).trim();
  if (patch.active !== undefined) updates.active = patch.active;
  if (patch.notes !== undefined) updates.notes = patch.notes;
  if (patch.parentSheet1Code !== undefined) {
    const parent = patch.parentSheet1Code || null;
    // parentId and parentSheet1Code are written together - they are the same
    // relationship stored twice, and letting them disagree would make the
    // resolver and the stored document tell different stories.
    updates.parentSheet1Code = parent;
    updates.parentId = parent;
  }

  await safeUpdateDoc(doc(db, COST_CENTER_HIERARCHY_COLLECTION, sheet1Code), updates);
  await invalidateCachedCollection(
    auth.currentUser?.uid || 'anonymous',
    COST_CENTER_HIERARCHY_COLLECTION,
  );

  const changed = Object.keys(updates)
    .filter((k) => k !== 'updatedAt')
    .map((k) => `${k}: "${before ? (before as any)[k] ?? '' : ''}" -> "${updates[k] ?? ''}"`)
    .join('، ');
  await logAuditAction(
    'UPDATE',
    COST_CENTER_HIERARCHY_COLLECTION,
    sheet1Code,
    `تعديل عنصر التسلسل الهرمي (${sheet1Code}): ${changed} - السبب: ${reason}`,
  );
}

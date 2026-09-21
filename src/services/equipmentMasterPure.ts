/**
 * Equipment master completion - Phase 1 Step 1D. Pure and Firebase-free.
 *
 * NOT A SECOND EQUIPMENT SYSTEM. Every equipment category is still its own
 * existing Master Data collection, served by the shared Master Data tab engine,
 * the shared audited create/update and the shared hierarchy resolver. This
 * file only adds what those did not yet have for the three categories that
 * were never managed from the Master Data screen:
 *
 *   tubeBallMills  existing collection, created until now only by the Tube/Ball
 *                  Mills Historical Import ("Code New Mill")
 *   bunkers        existing collection, created until now only by that import
 *   rotaryKilns    NEW collection. The Rotary Kiln was only ever free text
 *                  (RotaryFurnaceRecord.machineInfo); the hierarchy already has
 *                  a real EQUIPMENT node for it (5011 under 501). It is not a
 *                  `furnaces` record because that collection holds the tunnel
 *                  kilns a pressing record selects as furnaceId.
 *
 * THREE CONCEPTS STAY SEPARATE. An equipment record says which physical asset
 * it is. `hierarchyNodeId` is optional and only its current / default place in
 * the cost-centre hierarchy - never the operation it performs, and never
 * required. Operations reference equipment CATEGORIES (operationMasterPure.ts),
 * not records, and nothing here knows about operations or routes.
 *
 * WHICH CATEGORIES CARRY A HIERARCHY LINK, and why furnace cars do not:
 *   presses, furnaces, mills  already carried it (unchanged)
 *   tubeBallMills             six real EQUIPMENT nodes exist (51111..51124)
 *   rotaryKilns               a real EQUIPMENT node exists (5011)
 *   bunkers                   no EQUIPMENT node exists, but a bunker is a
 *                             physical asset with a location; the link is
 *                             optional and points at whatever node the user
 *                             chooses. Never reconciled by code (see below).
 *   furnaceCars               LEFT UNCHANGED. A car is a sub-resource of a
 *                             furnace (furnaceId); no hierarchy node represents
 *                             a car, and its cost location is the furnace's.
 *                             A direct link would create a second, competing
 *                             path to the same cost centre.
 *
 * HISTORY IS NEVER TOUCHED. Nothing here reads or writes production or stage
 * documents; millType, storageBunker and machineInfo stay exactly as stored.
 */
import type { MasterDataTab } from '../types';
import type { HierarchyIndex } from './hierarchyResolverPure';
import { validateEquipmentLink } from './hierarchyResolverPure';
import { normalizeCode } from '../utils/searchUtils';

/** Equipment tabs whose records carry an optional `hierarchyNodeId`. Furnace cars are deliberately absent. */
export const EQUIPMENT_LINK_TABS: readonly MasterDataTab[] = ['presses', 'furnaces', 'mills', 'tubeBallMills', 'bunkers', 'rotaryKilns'];

/**
 * Equipment tabs completed in this step: saved through `equipmentPayloadForSave`
 * after `validateEquipmentForSave`, and retired (inactive) rather than deleted,
 * because historical records point at their ids (millTypeId, bunkerAllocations).
 * Presses, furnaces, mills and furnace cars keep their existing behaviour.
 */
export const COMPLETED_EQUIPMENT_TABS: readonly MasterDataTab[] = ['tubeBallMills', 'bunkers', 'rotaryKilns'];

export const EQUIPMENT_STATUSES = ['active', 'maintenance', 'inactive'] as const;

export function isEquipmentLinkTab(tab: string): boolean {
  return (EQUIPMENT_LINK_TABS as readonly string[]).includes(tab);
}

export function isCompletedEquipmentTab(tab: string): tab is 'tubeBallMills' | 'bunkers' | 'rotaryKilns' {
  return (COMPLETED_EQUIPMENT_TABS as readonly string[]).includes(tab);
}

export interface EquipmentIssue {
  field: string;
  messageAr: string;
  messageEn: string;
}

export interface EquipmentValidation {
  valid: boolean;
  issues: EquipmentIssue[];
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim();
}

/**
 * The exact document shape to write for a completed equipment tab.
 *
 * Only that category's own fields - never `id`, timestamps or `externalRefs` -
 * so an edit cannot overwrite what it did not show. The shared update is a
 * merge, so fields not listed here (e.g. externalRefs) stay as stored.
 */
export function equipmentPayloadForSave(tab: 'tubeBallMills' | 'bunkers' | 'rotaryKilns', input: Record<string, unknown>): Record<string, unknown> {
  const node = text(input.hierarchyNodeId);
  const statusText = text(input.status);
  const common = {
    code: text(input.code),
    status: (EQUIPMENT_STATUSES as readonly string[]).includes(statusText) ? statusText : 'active',
    hierarchyNodeId: node === '' ? null : node,
    active: input.active !== false,
  };
  if (tab === 'bunkers') {
    return { ...common, bunkerNumber: text(input.bunkerNumber), name: text(input.name), center: text(input.center), notes: text(input.notes) };
  }
  if (tab === 'rotaryKilns') {
    return { ...common, name: text(input.name), model: text(input.model), description: text(input.description) };
  }
  // Phase 1 Step 8C-5: TUBE or BALL when chosen; null means not identified - never guessed.
  const kind = text(input.millKind).toUpperCase();
  return { ...common, name: text(input.name), model: text(input.model), millKind: kind === 'TUBE' || kind === 'BALL' ? kind : null };
}

/**
 * One identity value must not already belong to another record of the same
 * category. Exact after the existing code normalisation - no fuzzy matching.
 * Inactive records count: a retired code stays reserved.
 *
 * An edit that leaves the value unchanged is never blocked, so a record that
 * already shares a value with another (imported before this rule existed) can
 * still be linked or retired. It just cannot create a new duplicate.
 */
function duplicateOf(
  existing: ReadonlyArray<Record<string, unknown>>,
  field: string,
  value: string,
  editingId: string | null | undefined,
): Record<string, unknown> | undefined {
  const wanted = normalizeCode(value);
  if (!wanted) return undefined;
  if (editingId) {
    const self = existing.find((e) => String(e.id ?? '') === editingId);
    if (self && normalizeCode(text(self[field])) === wanted) return undefined;
  }
  return existing.find((e) => String(e.id ?? '') !== String(editingId ?? '') && normalizeCode(text(e[field])) === wanted);
}

/**
 * Validates a completed equipment tab's record before the shared write.
 *
 *   code            required for Tube/Ball Mills and Rotary Kilns; optional for
 *                   bunkers, as the existing Bunker type declares. Unique in
 *                   its own collection when present.
 *   name            required, per the existing type (a bunker's is bunkerNumber,
 *                   which is then also unique).
 *   hierarchyNodeId optional; when set it must exist in the shared hierarchy,
 *                   checked by the shared validateEquipmentLink.
 */
export function validateEquipmentForSave(
  tab: 'tubeBallMills' | 'bunkers' | 'rotaryKilns',
  existing: ReadonlyArray<Record<string, unknown>>,
  draft: Record<string, unknown>,
  context: { hierarchyIndex: HierarchyIndex<any>; editingId?: string | null },
): EquipmentValidation {
  const issues: EquipmentIssue[] = [];
  const record = equipmentPayloadForSave(tab, draft);
  const editingId = context.editingId ?? null;
  const code = text(record.code);

  if (!code && tab !== 'bunkers') {
    issues.push({ field: 'code', messageAr: 'حقل الكود إلزامي.', messageEn: 'Code is required.' });
  }
  if (code) {
    const other = duplicateOf(existing, 'code', code, editingId);
    if (other) {
      issues.push({
        field: 'code',
        messageAr: `الكود "${code}" مسجل بالفعل لمعدة أخرى في نفس الفئة.`,
        messageEn: `Code "${code}" already belongs to another record in this category.`,
      });
    }
  }

  if (tab === 'bunkers') {
    const bunkerNumber = text(record.bunkerNumber);
    if (!bunkerNumber) {
      issues.push({ field: 'bunkerNumber', messageAr: 'رقم البنكر إلزامي.', messageEn: 'Bunker number is required.' });
    } else if (duplicateOf(existing, 'bunkerNumber', bunkerNumber, editingId)) {
      issues.push({
        field: 'bunkerNumber',
        messageAr: `رقم البنكر "${bunkerNumber}" مسجل بالفعل.`,
        messageEn: `Bunker number "${bunkerNumber}" already exists.`,
      });
    }
  } else if (!text(record.name)) {
    issues.push({ field: 'name', messageAr: 'حقل الاسم إلزامي.', messageEn: 'Name is required.' });
  }

  if (tab === 'tubeBallMills') {
    const kind = text(draft.millKind).toUpperCase();
    if (kind && kind !== 'TUBE' && kind !== 'BALL') {
      issues.push({ field: 'millKind', messageAr: 'نوع الطاحونة يجب أن يكون أنبوبية أو كرات.', messageEn: 'The mill type must be TUBE or BALL.' });
    }
  }

  const nodeId = record.hierarchyNodeId as string | null;
  const link = validateEquipmentLink(context.hierarchyIndex, nodeId);
  if (!link.valid) {
    issues.push(...link.issues.map((i) => ({ field: 'hierarchyNodeId', messageAr: i.messageAr, messageEn: i.messageEn })));
  } else if (nodeId && !context.hierarchyIndex.byId.has(nodeId)) {
    // The resolver also accepts a node CODE; the stored link must be the stable node id.
    issues.push({
      field: 'hierarchyNodeId',
      messageAr: `يجب أن يكون الربط بمعرّف عقدة التسلسل الهرمي وليس بالكود "${nodeId}".`,
      messageEn: `The link must store the hierarchy node id, not the code "${nodeId}".`,
    });
  }

  return { valid: issues.length === 0, issues };
}

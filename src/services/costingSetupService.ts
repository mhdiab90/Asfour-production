/**
 * Costing setup writes - Phase 1 Step 8C.
 *
 * Adds no write path of its own: costing periods and allocation rows are saved
 * through the shared createMasterDataItem / updateMasterDataItem (sanitised
 * write, cache invalidation, audit entry), exactly like any other master data,
 * with validation in front and a descriptive audit line after - the existing
 * "[TAG] details" pattern.
 *
 * NOTHING HERE CALCULATES COST. It stores configuration: periods and their
 * lifecycle, and allocation rows (source, target, method, driver, driver
 * source, sequence, effective window). A CLOSED period is refused any edit; the
 * only way back is `reopenCostingPeriod`, which demands a reason, is audited,
 * and raises the calculation version so the closed result stays readable.
 *
 * Nothing is deleted, no production, BOM, job or batch is touched, and no
 * historical data is migrated.
 */
import { createMasterDataItem, fetchMasterData, updateMasterDataItem } from './masterDataService';
import { logAuditAction } from './auditService';
import {
  COSTING_PERIOD_COLLECTION,
  costingPeriodEditIssues,
  costingPeriodPayloadForSave,
  describeCostingPeriodChange,
  planCostingPeriodReopen,
  planCostingPeriodTransition,
  validateCostingPeriodForSave,
} from './costingPeriodPure';
import type { CostingIssue } from './costingPeriodPure';
import {
  ALLOCATION_SETUP_COLLECTION,
  allocationSetupPayloadForSave,
  describeAllocationSetupChange,
  validateAllocationSetupForSave,
} from './costingSetupPure';

type Stored = Record<string, any> & { id?: string };

function refuse(issues: readonly CostingIssue[], language: 'ar' | 'en'): never {
  throw new Error(issues.map((i) => (language === 'ar' ? i.messageAr : i.messageEn)).join(' | '));
}

export async function listCostingPeriods(options?: { skipCache?: boolean }): Promise<Stored[]> {
  return fetchMasterData<Stored>(COSTING_PERIOD_COLLECTION, options);
}

export async function listAllocationSetups(options?: { skipCache?: boolean }): Promise<Stored[]> {
  return fetchMasterData<Stored>(ALLOCATION_SETUP_COLLECTION, options);
}

/** Creates a period (OPEN unless another status is given) after full validation. */
export async function saveCostingPeriod(
  existing: readonly Stored[],
  stored: Stored | null,
  draft: Record<string, unknown>,
  language: 'ar' | 'en',
): Promise<string | undefined> {
  // A closed period never changes in place - see reopenCostingPeriod.
  const frozen = costingPeriodEditIssues(stored, draft);
  if (frozen.length) refuse(frozen, language);
  const check = validateCostingPeriodForSave(existing, draft, { editingId: stored?.id ?? null });
  if (!check.valid) refuse(check.issues, language);
  const payload = costingPeriodPayloadForSave(draft);
  if (stored?.id) {
    await updateMasterDataItem(COSTING_PERIOD_COLLECTION, String(stored.id), payload);
    logAuditAction('UPDATE', COSTING_PERIOD_COLLECTION, String(stored.id), describeCostingPeriodChange(stored, payload)).catch(() => {});
    return String(stored.id);
  }
  const id = await createMasterDataItem(COSTING_PERIOD_COLLECTION, payload);
  logAuditAction('CREATE', COSTING_PERIOD_COLLECTION, id, describeCostingPeriodChange(null, payload)).catch(() => {});
  return id;
}

/** Moves a period one lifecycle step, stamping who and when. Writes the status only. */
export async function transitionCostingPeriod(
  stored: Stored,
  next: string,
  actor: { userId?: string | null; at?: string | null },
  language: 'ar' | 'en',
): Promise<void> {
  const plan = planCostingPeriodTransition(stored, next, actor);
  if (!plan.valid) refuse(plan.issues, language);
  await updateMasterDataItem(COSTING_PERIOD_COLLECTION, String(stored.id), plan.patch);
  logAuditAction(next.toUpperCase() === 'CLOSED' ? 'DEACTIVATE' : 'UPDATE', COSTING_PERIOD_COLLECTION, String(stored.id), describeCostingPeriodChange(stored, { ...stored, ...plan.patch })).catch(() => {});
}

/**
 * Reopens a CLOSED period with a recorded reason. The closed result is never
 * edited: the period returns to OPEN under a NEW calculation version.
 */
export async function reopenCostingPeriod(
  stored: Stored,
  reason: string,
  actor: { userId?: string | null; at?: string | null },
  language: 'ar' | 'en',
): Promise<void> {
  const plan = planCostingPeriodReopen(stored, reason, actor);
  if (!plan.valid) refuse(plan.issues, language);
  await updateMasterDataItem(COSTING_PERIOD_COLLECTION, String(stored.id), plan.patch);
  logAuditAction('UPDATE', COSTING_PERIOD_COLLECTION, String(stored.id), describeCostingPeriodChange(stored, { ...stored, ...plan.patch })).catch(() => {});
}

/** Creates or updates one allocation row after full validation. */
export async function saveAllocationSetup(
  existing: readonly Stored[],
  stored: Stored | null,
  draft: Record<string, unknown>,
  context: { knownCostCenterCodes?: ReadonlySet<string> | null },
  language: 'ar' | 'en',
): Promise<string | undefined> {
  const check = validateAllocationSetupForSave(existing, draft, { editingId: stored?.id ?? null, ...context });
  if (!check.valid) refuse(check.issues, language);
  const payload = allocationSetupPayloadForSave(draft);
  if (stored?.id) {
    await updateMasterDataItem(ALLOCATION_SETUP_COLLECTION, String(stored.id), payload);
    logAuditAction('UPDATE', ALLOCATION_SETUP_COLLECTION, String(stored.id), describeAllocationSetupChange(stored, payload)).catch(() => {});
    return String(stored.id);
  }
  const id = await createMasterDataItem(ALLOCATION_SETUP_COLLECTION, payload);
  logAuditAction('CREATE', ALLOCATION_SETUP_COLLECTION, id, describeAllocationSetupChange(null, payload)).catch(() => {});
  return id;
}

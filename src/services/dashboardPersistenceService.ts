/**
 * Custom Dashboard persistence (§25/31: Save/Rename/Duplicate/Delete/Set-Default).
 *
 * Follows the EXACT precedent already established by LanguageContext.tsx,
 * which persists the user's language choice to localStorage under
 * 'asfour_erp_lang' - this is a client-side UI-preference/layout concern,
 * not business data, so it does not need a new Firestore collection and
 * must not touch Firebase architecture (explicit CRITICAL constraint).
 * Saved dashboards are scoped per browser/device, same as the language
 * preference already is.
 *
 * ---------------------------------------------------------------------
 * PERSISTENCE MODEL: localStorage ONLY - deliberate, not an oversight.
 * ---------------------------------------------------------------------
 * Every function in this module reads and writes exactly one localStorage
 * key (STORAGE_KEY below). There is no Firestore read, write, collection,
 * security rule or permission involved anywhere in this file, and none
 * should be added without an explicit product decision. The consequences
 * are real and should be understood before relying on saved dashboards:
 *
 *  - LOCAL TO ONE BROWSER. A dashboard saved in Chrome on the office PC
 *    does not exist in Edge on that same PC, nor on a phone or a second
 *    workstation. There is no cross-device sync.
 *  - PER USER PROFILE, NOT PER ERP ACCOUNT. The store is keyed by browser
 *    profile, not by the signed-in ERP user, so two people sharing one
 *    machine and browser profile share the same saved dashboards, and the
 *    same ERP account signed in elsewhere sees none of them.
 *  - LOST WHEN SITE DATA IS CLEARED. Clearing browsing data, "reset
 *    browser settings", private/incognito windows, and some corporate
 *    device-management policies all remove saved dashboards permanently.
 *  - NOT COVERED BY BACKUP / RESTORE. backupService.ts backs up Firestore
 *    collections; because dashboards never reach Firestore they are absent
 *    from every backup file and cannot be recovered by a restore.
 *  - NO MIGRATION HOOK. There is no schema-version field and no
 *    migrate-on-read step. `readState` below only lazily backfills
 *    `dashboardNumber`; any other future shape change would need a
 *    migration written first, or older saved layouts will be dropped.
 *  - CORRUPTION DEGRADES TO EMPTY. Unparseable stored JSON is treated as
 *    "no saved dashboards" rather than throwing, so the Builder still
 *    opens - but the previous layouts are gone.
 *
 * A dashboard layout is a user's private view configuration, not business
 * data: production records, master data and audit trails all live in
 * Firestore and are unaffected by any of the above. Only the arrangement
 * of widgets is at risk.
 *
 * Behaviour verified by scripts/tests/dashboardBuilder.test.ts (save/load,
 * rename, duplicate independence, delete, default/favourite, single-key
 * localStorage isolation, no-Firestore-write guard, and corrupt-JSON
 * degradation).
 */
import { DashboardLayout } from './dashboardRegistry';
import { logAuditAction } from './auditService';
import { auth } from '../config/firebase';

const STORAGE_KEY = 'asfour_erp_dashboards';

interface StoredState {
  dashboards: DashboardLayout[];
  defaultDashboardId: string | null;
}

function writeState(state: StoredState): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

/**
 * Phase 4B §2 - lazily backfills `dashboardNumber` for any dashboard saved
 * before this field existed, assigning the next available integer above the
 * current max so no two dashboards can ever collide. Runs on every read
 * (readState()) rather than a one-time migration script, since this is a
 * client-side localStorage store with no migration-on-deploy hook - the
 * first read after upgrading is effectively the migration. Persists the
 * backfill immediately so the assigned number is stable from then on.
 */
function ensureNumbered(state: StoredState): StoredState {
  let changed = false;
  let nextNumber = state.dashboards.reduce((max, d) => Math.max(max, d.dashboardNumber || 0), 0) + 1;
  for (const d of state.dashboards) {
    if (!d.dashboardNumber) {
      d.dashboardNumber = nextNumber;
      nextNumber += 1;
      changed = true;
    }
  }
  if (changed) writeState(state);
  return state;
}

function readState(): StoredState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { dashboards: [], defaultDashboardId: null };
    const parsed = JSON.parse(raw);
    const state: StoredState = { dashboards: Array.isArray(parsed.dashboards) ? parsed.dashboards : [], defaultDashboardId: parsed.defaultDashboardId || null };
    return ensureNumbered(state);
  } catch {
    return { dashboards: [], defaultDashboardId: null };
  }
}

export function listDashboards(): DashboardLayout[] {
  return readState().dashboards;
}

export function getDefaultDashboardId(): string | null {
  return readState().defaultDashboardId;
}

export function getDashboard(dashboardId: string): DashboardLayout | undefined {
  return readState().dashboards.find((d) => d.dashboardId === dashboardId);
}

/** Phase 4B §2/§15 - resolves "اللوحة رقم N" against the stable, never-reassigned dashboardNumber. */
export function getDashboardByNumber(dashboardNumber: number): DashboardLayout | undefined {
  return readState().dashboards.find((d) => d.dashboardNumber === dashboardNumber);
}

function genId(): string {
  return `dash_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Part 10 audit trail - reuses the existing generic CREATE/UPDATE/DELETE actions and the `dashboards` "collection" label, exactly as other client-side-only flows in this app already do, rather than growing AuditLog['action'] for every new screen. Best-effort: a write failure here never blocks the actual save (same fire-and-forget posture as every other logAuditAction call site). */
function auditDashboard(action: 'CREATE' | 'UPDATE' | 'DELETE', dashboardId: string, summary: string): void {
  logAuditAction(action, 'dashboards', dashboardId, summary).catch(() => {});
}

export function saveDashboard(layout: Omit<DashboardLayout, 'dashboardId' | 'dashboardNumber' | 'createdAt' | 'updatedAt'> & { dashboardId?: string; dashboardNumber?: number }): DashboardLayout {
  const state = readState();
  const now = new Date().toISOString();
  if (layout.dashboardId) {
    const idx = state.dashboards.findIndex((d) => d.dashboardId === layout.dashboardId);
    if (idx >= 0) {
      const updated: DashboardLayout = { ...state.dashboards[idx], ...layout, dashboardId: layout.dashboardId, updatedAt: now };
      state.dashboards[idx] = updated;
      writeState(state);
      auditDashboard('UPDATE', updated.dashboardId, `تعديل لوحة "${updated.name}" (${updated.sections.length} قسم)`);
      return updated;
    }
  }
  const nextNumber = state.dashboards.reduce((max, d) => Math.max(max, d.dashboardNumber || 0), 0) + 1;
  const created: DashboardLayout = { ...layout, dashboardId: genId(), dashboardNumber: nextNumber, ownerName: layout.ownerName || auth.currentUser?.email || '', createdAt: now, updatedAt: now };
  state.dashboards.push(created);
  writeState(state);
  auditDashboard('CREATE', created.dashboardId, `إنشاء لوحة "${created.name}"${created.isReport ? ' (تقرير)' : ''}`);
  return created;
}

export function renameDashboard(dashboardId: string, name: string): void {
  const state = readState();
  const dash = state.dashboards.find((d) => d.dashboardId === dashboardId);
  if (dash) {
    dash.name = name;
    dash.updatedAt = new Date().toISOString();
    writeState(state);
  }
}

export function duplicateDashboard(dashboardId: string, newName: string): DashboardLayout | undefined {
  const state = readState();
  const source = state.dashboards.find((d) => d.dashboardId === dashboardId);
  if (!source) return undefined;
  const now = new Date().toISOString();
  const nextNumber = state.dashboards.reduce((max, d) => Math.max(max, d.dashboardNumber || 0), 0) + 1;
  const copy: DashboardLayout = {
    ...JSON.parse(JSON.stringify(source)),
    dashboardId: genId(),
    dashboardNumber: nextNumber,
    name: newName,
    isDefault: false,
    isFavorite: false,
    ownerName: auth.currentUser?.email || source.ownerName || '',
    createdAt: now,
    updatedAt: now,
  };
  state.dashboards.push(copy);
  writeState(state);
  auditDashboard('CREATE', copy.dashboardId, `نسخ لوحة "${source.name}" إلى "${copy.name}"`);
  return copy;
}

/**
 * Deletes ONLY the saved layout configuration document in localStorage -
 * never touches Firestore, so Production Records / Employees / Master Data
 * / Reports data are categorically unaffected (Part 3 §10 CRITICAL). If the
 * deleted dashboard was the default, the default pointer is cleared here;
 * the caller (DashboardBuilderView) falls back to another available
 * dashboard on its next read, so the app never points at a missing id
 * (Part 3 §12 / TEST 6).
 */
export function deleteDashboard(dashboardId: string): void {
  const state = readState();
  const target = state.dashboards.find((d) => d.dashboardId === dashboardId);
  state.dashboards = state.dashboards.filter((d) => d.dashboardId !== dashboardId);
  if (state.defaultDashboardId === dashboardId) state.defaultDashboardId = null;
  writeState(state);
  if (target) auditDashboard('DELETE', dashboardId, `حذف لوحة "${target.name}" (تكوين اللوحة فقط - لا تأثير على بيانات الإنتاج)`);
}

/** Bulk delete (Part 3 §11) - same single-document-per-dashboard guarantee as deleteDashboard, just applied to a set. */
export function deleteDashboards(dashboardIds: string[]): void {
  const state = readState();
  const targets = state.dashboards.filter((d) => dashboardIds.includes(d.dashboardId));
  state.dashboards = state.dashboards.filter((d) => !dashboardIds.includes(d.dashboardId));
  if (state.defaultDashboardId && dashboardIds.includes(state.defaultDashboardId)) state.defaultDashboardId = null;
  writeState(state);
  for (const t of targets) auditDashboard('DELETE', t.dashboardId, `حذف جماعي: لوحة "${t.name}" (تكوين اللوحة فقط)`);
}

export function setDefaultDashboard(dashboardId: string | null): void {
  const state = readState();
  state.defaultDashboardId = dashboardId;
  writeState(state);
}

export function setFavoriteDashboard(dashboardId: string, isFavorite: boolean): void {
  const state = readState();
  const dash = state.dashboards.find((d) => d.dashboardId === dashboardId);
  if (dash) {
    dash.isFavorite = isFavorite;
    writeState(state);
  }
}

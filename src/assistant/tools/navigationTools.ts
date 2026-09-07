/**
 * Navigation tool. Reuses the EXISTING canAccessPage() permission check
 * (src/utils/permissions.ts) via a minimal synthetic AdminUser built from
 * ScreenContext - no parallel permission model. Actual navigation happens
 * through App.tsx's real, already permission-enforcing handleNavigate,
 * bridged via src/assistant/navigationBridge.ts, so an unauthorized user is
 * blocked exactly as they would be clicking the sidebar themselves.
 */
import { NavigationPage, MasterDataTab } from '../../types';
import { canAccessPage } from '../../utils/permissions';
import { ToolDefinition } from '../types';
import { registerTool } from './registry';
import { requestNavigation } from '../navigationBridge';
import { syntheticUserFromContext } from '../permissionGuard';
import {
  NAVIGATE_TO_PAGE_SCHEMA,
  OPEN_REPORT_VIEW_SCHEMA,
  SET_DASHBOARD_DATE_FILTER_SCHEMA,
  SET_DASHBOARD_STAGE_FILTER_SCHEMA,
  SET_DASHBOARD_SHIFT_FILTER_SCHEMA,
  SET_DASHBOARD_ENTITY_FILTER_SCHEMA,
  SET_DASHBOARD_SORT_SCHEMA,
  NO_PARAMS_SCHEMA,
  OPEN_MASTER_DATA_RECORD_SCHEMA,
} from './parameterSchemas';
import { REPORT_CATEGORIES, ALL_STAGES, RankingMetric } from '../../services/reportingEngine';
import {
  REPORT_PREFILL_KEY,
  REPORT_PREFILL_EVENT,
  REPORT_REFRESH_EVENT,
  REPORT_RESET_EVENT,
  ReportPrefill,
} from '../../components/reports/ReportsView';
import {
  DASHBOARD_FILTER_UPDATE_EVENT,
  DASHBOARD_FILTER_RESET_EVENT,
  DASHBOARD_REFRESH_EVENT,
  DASHBOARD_DATE_PRESETS,
  DashboardDatePreset,
  DashboardFilterPatch,
} from '../../components/dashboard/DashboardView';
import { MASTER_DATA_PREFILL_KEY, MASTER_DATA_PREFILL_EVENT, MasterDataPrefill } from '../../components/masterData/MasterDataView';
import { MASTER_DATA_COLLECTIONS } from '../../services/masterDataService';
import { resolveSingleMasterDataMatch } from './masterDataTools';

const VALID_PAGES: NavigationPage[] = [
  'dashboard', 'production', 'production-entry', 'production-records', 'data-review',
  'historical-import', 'raw-materials', 'ai-assistant', 'material-traceability', 'data-quality',
  'backup-restore', 'backups', 'restore', 'system-health', 'versions', 'master-data',
  'bulk-entry', 'reports', 'settings', 'branding', 'user-management', 'admin-panel',
  'translation-manager', 'language-audit', 'ai-provider-management',
];

const navigateToPage: ToolDefinition = {
  toolName: 'navigateToPage',
  descriptionAr: 'الانتقال إلى شاشة محددة داخل النظام',
  descriptionEn: 'Navigate to a specific screen within the ERP',
  commandType: 'NAVIGATION',
  riskLevel: 'LOW_RISK',
  confirmationPolicy: 'NONE',
  // Page access itself is checked per-target-page inside execute() below
  // (the target varies per call), so this tool requires no single fixed
  // permission - it relies entirely on the real canAccessPage() check.
  requiredPermission: [],
  parameterSchema: NAVIGATE_TO_PAGE_SCHEMA,
  inputSchema: (input) => {
    const page = String(input?.page || '').trim() as NavigationPage;
    if (!VALID_PAGES.includes(page)) {
      return { valid: false, errors: [`Unknown or unsupported page: ${page}`] };
    }
    return { valid: true, value: { page } };
  },
  execute: async (input, context) => {
    if (!canAccessPage(syntheticUserFromContext(context), input.page)) {
      return {
        success: false,
        errorCode: 'PAGE_ACCESS_DENIED',
        messageAr: 'عفواً، لا تملك الصلاحية للانتقال إلى هذه الشاشة.',
        messageEn: 'Sorry, you do not have permission to open that screen.',
      };
    }

    const dispatched = requestNavigation(input.page);
    return {
      success: dispatched,
      data: { page: input.page },
      // Phase 4 §43 - a specific safe reason beats the generic fallback
      // whenever one is actually known (here: the navigation bridge simply
      // hasn't registered yet, e.g. a very early/cold app load).
      messageAr: dispatched ? `تم الانتقال إلى شاشة (${input.page}).` : 'تعذر الانتقال حالياً - أعد المحاولة خلال لحظات.',
      messageEn: dispatched ? `Navigated to (${input.page}).` : 'Unable to navigate right now - please try again in a moment.',
      errorCode: dispatched ? undefined : 'NAVIGATION_BRIDGE_NOT_READY',
    };
  },
};

/**
 * Phase 4 §11/§13/§14/§16/§22/§23 - "افتح تقرير المكابس" / "اعرض مايو 2026"
 * (as a navigate-and-view request). Reuses the EXACT session-local handoff
 * the Dashboard Builder's "Open full report" widget action already uses
 * (REPORT_PREFILL_KEY, ReportsView.tsx) - not a new mechanism, the third
 * consumer of an established pattern. Named-month/relative-date resolution
 * is NOT reimplemented here: this tool's schema declares startDate/endDate,
 * so gateway.ts's existing generic date-injection (extractExplicitMonthRange)
 * already overrides them for any explicit month reference in the raw user
 * text, exactly as it does for every analytics tool.
 */
const openReportView: ToolDefinition = {
  toolName: 'openReportView',
  descriptionAr: 'فتح شاشة التقارير مع تطبيق فئة التقرير/المرحلة/الفترة المطلوبة مباشرة',
  descriptionEn: 'Open the Reports screen with the requested report category/stage/period pre-applied',
  commandType: 'NAVIGATION',
  riskLevel: 'LOW_RISK',
  confirmationPolicy: 'NONE',
  requiredPermission: ['reports.view'],
  parameterSchema: OPEN_REPORT_VIEW_SCHEMA,
  inputSchema: (input) => {
    const categoryId = input?.categoryId ? String(input.categoryId).trim() : undefined;
    if (categoryId && !REPORT_CATEGORIES.some((c) => c.id === categoryId)) {
      return { valid: false, errors: [`Unknown report category "${categoryId}". Valid: ${REPORT_CATEGORIES.map((c) => c.id).join(', ')}`] };
    }
    const stageType = input?.stageType ? String(input.stageType).trim() : undefined;
    if (stageType && !ALL_STAGES.includes(stageType as any)) {
      return { valid: false, errors: [`Unknown stage "${stageType}". Valid: ${ALL_STAGES.join(', ')}`] };
    }
    return {
      valid: true,
      value: {
        categoryId,
        stageType,
        startDate: input?.startDate ? String(input.startDate) : undefined,
        endDate: input?.endDate ? String(input.endDate) : undefined,
      },
    };
  },
  execute: async (input, context) => {
    if (!canAccessPage(syntheticUserFromContext(context), 'reports')) {
      return {
        success: false,
        errorCode: 'PAGE_ACCESS_DENIED',
        messageAr: 'عفواً، لا تملك الصلاحية لفتح شاشة التقارير.',
        messageEn: 'Sorry, you do not have permission to open the Reports screen.',
      };
    }

    const prefill: ReportPrefill = {
      categoryId: input.categoryId,
      stageType: input.stageType,
      startDate: input.startDate,
      endDate: input.endDate,
    };

    try {
      sessionStorage.setItem(REPORT_PREFILL_KEY, JSON.stringify(prefill));
    } catch {
      // Storage can genuinely be unavailable (private browsing, quota) - the
      // live event below still covers the "already on Reports" case even then.
    }
    // Covers the case where the user is ALREADY on Reports (no remount, so
    // the sessionStorage read on mount would never re-fire) - applies the
    // SAME prefill live, through ReportsView's own React state setters. A
    // dispatch with no listener (ReportsView not currently mounted) is a
    // harmless no-op - requestNavigation() below is what actually gets the
    // user there in that case.
    window.dispatchEvent(new CustomEvent(REPORT_PREFILL_EVENT, { detail: prefill }));
    // §43/navigateToPage parity - honest success/failure, never claimed true
    // regardless of outcome: requestNavigation() returning false means the
    // navigation bridge itself isn't registered, so neither a fresh
    // navigation NOR the live event (nothing was mounted to receive it)
    // could have taken effect.
    const dispatched = requestNavigation('reports');

    const summaryAr = [
      input.categoryId ? `الفئة: ${input.categoryId}` : null,
      input.stageType ? `المرحلة: ${input.stageType}` : null,
      (input.startDate || input.endDate) ? `الفترة: ${input.startDate || '...'} → ${input.endDate || '...'}` : null,
    ].filter(Boolean).join('، ');
    const summaryEn = [
      input.categoryId ? `category: ${input.categoryId}` : null,
      input.stageType ? `stage: ${input.stageType}` : null,
      (input.startDate || input.endDate) ? `period: ${input.startDate || '...'} to ${input.endDate || '...'}` : null,
    ].filter(Boolean).join(', ');

    return {
      success: dispatched,
      data: { page: 'reports', ...prefill },
      messageAr: dispatched
        ? `تم فتح شاشة التقارير${summaryAr ? ` (${summaryAr})` : ''}.`
        : 'تعذر فتح شاشة التقارير حالياً - أعد المحاولة خلال لحظات.',
      messageEn: dispatched
        ? `Opened the Reports screen${summaryEn ? ` (${summaryEn})` : ''}.`
        : 'Unable to open the Reports screen right now - please try again in a moment.',
      errorCode: dispatched ? undefined : 'NAVIGATION_BRIDGE_NOT_READY',
    };
  },
};

/** Shared by every setDashboard*Filter tool below - same permission check + navigation-bridge honesty pattern as the rest of this file. */
function dashboardAccessDenied(context: { currentUserId?: string; currentRole?: string; currentPermissions?: any }) {
  if (canAccessPage(syntheticUserFromContext(context), 'dashboard')) return null;
  return {
    success: false as const,
    errorCode: 'PAGE_ACCESS_DENIED',
    messageAr: 'عفواً، لا تملك الصلاحية لعرض لوحة التحكم.',
    messageEn: 'Sorry, you do not have permission to view the Dashboard.',
  };
}

function dispatchDashboardPatch(patch: DashboardFilterPatch) {
  const navigated = requestNavigation('dashboard');
  // Targeted Dashboard Workflow Fix - navigating here from a DIFFERENT page
  // (e.g. a chained tool call that just opened Reports) means DashboardView
  // is not yet mounted, so its patch-event listener (registered in a
  // post-mount useEffect) isn't attached yet: dispatching synchronously, as
  // this used to, fired the CustomEvent before that listener existed and
  // silently dropped the patch. Deferring one tick lets the navigation's
  // state update commit and DashboardView mount/subscribe first - a no-op
  // delay when already on the Dashboard, since the listener is already live.
  setTimeout(() => window.dispatchEvent(new CustomEvent(DASHBOARD_FILTER_UPDATE_EVENT, { detail: patch })), 0);
  return navigated;
}

/**
 * Dashboard Capability Upgrade §1 - "اعرض هذا الشهر"/"اعرض آخر 30 يوم"/"اعرض
 * مايو 2026". Real presets validated against DASHBOARD_DATE_PRESETS
 * (DashboardView.tsx); "custom" requires startDate+endDate, "namedMonth"
 * requires month+year - never silently substitutes a different range.
 */
const setDashboardDateFilter: ToolDefinition = {
  toolName: 'setDashboardDateFilter',
  descriptionAr: 'ضبط فلتر التاريخ في لوحة التحكم (اليوم / الأسبوع / هذا الشهر / آخر 30 يوم / فترة مخصصة / شهر محدد)',
  descriptionEn: "Set the Dashboard's date filter (today / week / this month / last 30 days / custom range / named month)",
  commandType: 'NAVIGATION',
  riskLevel: 'LOW_RISK',
  confirmationPolicy: 'NONE',
  requiredPermission: ['dashboard.view'],
  parameterSchema: SET_DASHBOARD_DATE_FILTER_SCHEMA,
  inputSchema: (input) => {
    const preset = String(input?.preset || '').trim() as DashboardDatePreset;
    if (!DASHBOARD_DATE_PRESETS.includes(preset)) {
      return { valid: false, errors: [`preset must be one of: ${DASHBOARD_DATE_PRESETS.join(', ')}`] };
    }
    if (preset === 'custom') {
      if (!input?.startDate || !input?.endDate) return { valid: false, errors: ['startDate and endDate are required when preset="custom"'] };
      return { valid: true, value: { preset, startDate: String(input.startDate), endDate: String(input.endDate) } };
    }
    if (preset === 'namedMonth') {
      const month = Number(input?.month);
      const year = Number(input?.year);
      if (!month || month < 1 || month > 12 || !year) return { valid: false, errors: ['month (1-12) and year are required when preset="namedMonth"'] };
      return { valid: true, value: { preset, month, year } };
    }
    return { valid: true, value: { preset } };
  },
  execute: async (input, context) => {
    const denied = dashboardAccessDenied(context);
    if (denied) return denied;
    const dispatched = dispatchDashboardPatch({ date: input });
    return {
      success: dispatched,
      data: { page: 'dashboard', date: input },
      messageAr: dispatched ? `تم تطبيق فلتر التاريخ (${input.preset}) في لوحة التحكم.` : 'تعذر تطبيق الفلتر حالياً - أعد المحاولة خلال لحظات.',
      messageEn: dispatched ? `Applied the "${input.preset}" date filter on the Dashboard.` : 'Unable to apply the filter right now - please try again in a moment.',
      errorCode: dispatched ? undefined : 'NAVIGATION_BRIDGE_NOT_READY',
    };
  },
};

/** Dashboard Capability Upgrade §2 - "اعرض بيانات مرحلة الفرن الدوار فقط". Validated against ALL_STAGES (reportingEngine.ts) - the same authoritative stage registry every other tool uses. */
const setDashboardStageFilter: ToolDefinition = {
  toolName: 'setDashboardStageFilter',
  descriptionAr: 'ضبط فلتر المرحلة الإنتاجية في لوحة التحكم',
  descriptionEn: "Set the Dashboard's production-stage filter",
  commandType: 'NAVIGATION',
  riskLevel: 'LOW_RISK',
  confirmationPolicy: 'NONE',
  requiredPermission: ['dashboard.view'],
  parameterSchema: SET_DASHBOARD_STAGE_FILTER_SCHEMA,
  inputSchema: (input) => {
    const stageType = String(input?.stageType || '').trim();
    if (stageType !== 'all' && !ALL_STAGES.includes(stageType as any)) {
      return { valid: false, errors: [`stageType must be "all" or one of: ${ALL_STAGES.join(', ')}`] };
    }
    return { valid: true, value: { stageType } };
  },
  execute: async (input, context) => {
    const denied = dashboardAccessDenied(context);
    if (denied) return denied;
    const dispatched = dispatchDashboardPatch({ stageType: input.stageType });
    return {
      success: dispatched,
      data: { page: 'dashboard', stageType: input.stageType },
      messageAr: dispatched ? `تم تطبيق فلتر المرحلة (${input.stageType}) في لوحة التحكم.` : 'تعذر تطبيق الفلتر حالياً - أعد المحاولة خلال لحظات.',
      messageEn: dispatched ? `Applied the stage filter ("${input.stageType}") on the Dashboard.` : 'Unable to apply the filter right now - please try again in a moment.',
      errorCode: dispatched ? undefined : 'NAVIGATION_BRIDGE_NOT_READY',
    };
  },
};

/** Dashboard Capability Upgrade §3 - reuses findMasterDataMatches('shifts', ...) (the SAME shift lookup searchMasterData/openMasterDataRecord use), never a new lookup. */
const setDashboardShiftFilter: ToolDefinition = {
  toolName: 'setDashboardShiftFilter',
  descriptionAr: 'ضبط فلتر الوردية في لوحة التحكم (أو إزالته)',
  descriptionEn: "Set (or clear) the Dashboard's shift filter",
  commandType: 'NAVIGATION',
  riskLevel: 'LOW_RISK',
  confirmationPolicy: 'NONE',
  requiredPermission: ['dashboard.view'],
  parameterSchema: SET_DASHBOARD_SHIFT_FILTER_SCHEMA,
  inputSchema: (input) => ({ valid: true, value: { shift: input?.shift ? String(input.shift).trim() : '' } }),
  execute: async (input, context) => {
    const denied = dashboardAccessDenied(context);
    if (denied) return denied;

    if (!input.shift) {
      const dispatched = dispatchDashboardPatch({ shiftId: null });
      return {
        success: dispatched,
        data: { page: 'dashboard', shiftId: null },
        messageAr: dispatched ? 'تمت إزالة فلتر الوردية في لوحة التحكم.' : 'تعذر تطبيق الفلتر حالياً - أعد المحاولة خلال لحظات.',
        messageEn: dispatched ? 'Cleared the Dashboard\'s shift filter.' : 'Unable to apply the filter right now - please try again in a moment.',
        errorCode: dispatched ? undefined : 'NAVIGATION_BRIDGE_NOT_READY',
      };
    }

    const resolved = await resolveSingleMasterDataMatch('shifts', input.shift.toLowerCase(), {
      notFoundAr: `لم يتم العثور على وردية مطابقة لـ "${input.shift}".`,
      notFoundEn: `No shift matching "${input.shift}" was found.`,
      ambiguousPrefixAr: 'يوجد أكثر من وردية مطابقة: ',
      ambiguousPrefixEn: 'More than one shift matches: ',
      ambiguousSuffixAr: '. أي واحدة تقصد؟',
      ambiguousSuffixEn: '. Which one do you mean?',
    });
    if (resolved.outcome !== 'FOUND') return resolved.result;

    const match = resolved.match;
    const shiftId = match.id || match.code;
    const dispatched = dispatchDashboardPatch({ shiftId });
    return {
      success: dispatched,
      data: { page: 'dashboard', shiftId, shiftName: match.name },
      messageAr: dispatched ? `تم تطبيق فلتر الوردية (${match.name || match.code}) في لوحة التحكم.` : 'تعذر تطبيق الفلتر حالياً - أعد المحاولة خلال لحظات.',
      messageEn: dispatched ? `Applied the shift filter ("${match.name || match.code}") on the Dashboard.` : 'Unable to apply the filter right now - please try again in a moment.',
      errorCode: dispatched ? undefined : 'NAVIGATION_BRIDGE_NOT_READY',
    };
  },
};

/** Dashboard Capability Upgrade §4 - press/employee/customer/product only (furnace car is NOT_AVAILABLE - see this file's schema comment). Reuses findMasterDataMatches() against the same collection searchMasterData uses for that domain. */
const ENTITY_TYPE_TO_COLLECTION: Record<string, string> = { press: 'presses', employee: 'employees', customer: 'customers', product: 'products' };
const ENTITY_TYPE_TO_FILTER_KEY: Record<string, 'pressId' | 'employeeId' | 'customerId' | 'productId'> = {
  press: 'pressId', employee: 'employeeId', customer: 'customerId', product: 'productId',
};

const setDashboardEntityFilter: ToolDefinition = {
  toolName: 'setDashboardEntityFilter',
  descriptionAr: 'ضبط فلتر كيان (مكبس/موظف/عميل/منتج) في لوحة التحكم (أو إزالته)',
  descriptionEn: "Set (or clear) a Dashboard entity filter (press/employee/customer/product)",
  commandType: 'NAVIGATION',
  riskLevel: 'LOW_RISK',
  confirmationPolicy: 'NONE',
  requiredPermission: ['dashboard.view'],
  parameterSchema: SET_DASHBOARD_ENTITY_FILTER_SCHEMA,
  inputSchema: (input) => {
    const entityType = String(input?.entityType || '').trim();
    if (!ENTITY_TYPE_TO_COLLECTION[entityType]) {
      return { valid: false, errors: [`entityType must be one of: ${Object.keys(ENTITY_TYPE_TO_COLLECTION).join(', ')}`] };
    }
    return { valid: true, value: { entityType, value: input?.value ? String(input.value).trim() : '' } };
  },
  execute: async (input, context) => {
    const denied = dashboardAccessDenied(context);
    if (denied) return denied;
    const filterKey = ENTITY_TYPE_TO_FILTER_KEY[input.entityType];

    if (!input.value) {
      const dispatched = dispatchDashboardPatch({ entity: { [filterKey]: undefined } });
      return {
        success: dispatched,
        data: { page: 'dashboard', entityType: input.entityType, cleared: true },
        messageAr: dispatched ? `تمت إزالة فلتر (${input.entityType}) في لوحة التحكم.` : 'تعذر تطبيق الفلتر حالياً - أعد المحاولة خلال لحظات.',
        messageEn: dispatched ? `Cleared the "${input.entityType}" filter on the Dashboard.` : 'Unable to apply the filter right now - please try again in a moment.',
        errorCode: dispatched ? undefined : 'NAVIGATION_BRIDGE_NOT_READY',
      };
    }

    const resolved = await resolveSingleMasterDataMatch(ENTITY_TYPE_TO_COLLECTION[input.entityType], input.value.toLowerCase(), {
      notFoundAr: `لم يتم العثور على عنصر مطابق لـ "${input.value}".`,
      notFoundEn: `No record matching "${input.value}" was found.`,
      ambiguousPrefixAr: 'يوجد أكثر من عنصر مطابق: ',
      ambiguousPrefixEn: 'More than one record matches: ',
      ambiguousSuffixAr: '. أي واحد تقصد؟',
      ambiguousSuffixEn: '. Which one do you mean?',
    });
    if (resolved.outcome !== 'FOUND') return resolved.result;

    const match = resolved.match;
    const dispatched = dispatchDashboardPatch({ entity: { [filterKey]: match.id } });
    return {
      success: dispatched,
      data: { page: 'dashboard', entityType: input.entityType, match: { id: match.id, name: match.name, code: match.code } },
      messageAr: dispatched ? `تم تطبيق فلتر (${input.entityType}: ${match.name || match.code}) في لوحة التحكم.` : 'تعذر تطبيق الفلتر حالياً - أعد المحاولة خلال لحظات.',
      messageEn: dispatched ? `Applied the "${input.entityType}" filter ("${match.name || match.code}") on the Dashboard.` : 'Unable to apply the filter right now - please try again in a moment.',
      errorCode: dispatched ? undefined : 'NAVIGATION_BRIDGE_NOT_READY',
    };
  },
};

/** Dashboard Capability Upgrade §9 - reuses the SAME RankingMetric enum (reportingEngine.ts) every "best/worst" analytics tool already uses; never a parallel sort-field vocabulary. */
const RANKING_METRICS: RankingMetric[] = ['productionTons', 'goodTons', 'wasteTons', 'wastePercentage', 'downtimeMinutes', 'operationsCount'];

const setDashboardSort: ToolDefinition = {
  toolName: 'setDashboardSort',
  // OpenRouter Dashboard Tool Selection fix - the previous description
  // ("equipment distribution table") was too narrow: this actually changes
  // the ACTUAL DASHBOARD'S sort/ranking order (dispatchDashboardPatch's
  // sortField/sortDirection is Dashboard-wide state, not one sub-table),
  // so "رتب حسب الإنتاج من الأعلى للأقل"/"sort by production, highest to
  // lowest" - while the user is looking at the Dashboard - never matched
  // this tool's own description well enough to be chosen over a standalone
  // ranking/analytics tool (getTopPresses etc.), which is a DIFFERENT
  // action (a fresh top-N query, not a change to what the Dashboard shows).
  descriptionAr: 'تغيير ترتيب/فرز البيانات المعروضة حاليًا في لوحة التحكم (وليس تصنيفًا تحليليًا منفصلًا)',
  descriptionEn: "Changes the sort/ranking order of what the Dashboard is currently displaying (not a separate analytics ranking query)",
  commandType: 'NAVIGATION',
  riskLevel: 'LOW_RISK',
  confirmationPolicy: 'NONE',
  requiredPermission: ['dashboard.view'],
  parameterSchema: SET_DASHBOARD_SORT_SCHEMA,
  inputSchema: (input) => {
    const field = String(input?.field || '').trim() as RankingMetric;
    if (!RANKING_METRICS.includes(field)) {
      return { valid: false, errors: [`field must be one of: ${RANKING_METRICS.join(', ')}`] };
    }
    const direction = input?.direction === 'worst' ? 'worst' : 'best';
    return { valid: true, value: { field, direction } };
  },
  execute: async (input, context) => {
    const denied = dashboardAccessDenied(context);
    if (denied) return denied;
    const dispatched = dispatchDashboardPatch({ sortField: input.field, sortDirection: input.direction });
    return {
      success: dispatched,
      data: { page: 'dashboard', sortField: input.field, sortDirection: input.direction },
      messageAr: dispatched ? `تم ضبط الترتيب حسب (${input.field}, ${input.direction === 'best' ? 'الأفضل' : 'الأسوأ'}) في لوحة التحكم.` : 'تعذر تطبيق الترتيب حالياً - أعد المحاولة خلال لحظات.',
      messageEn: dispatched ? `Applied sort by "${input.field}" (${input.direction}) on the Dashboard.` : 'Unable to apply the sort right now - please try again in a moment.',
      errorCode: dispatched ? undefined : 'NAVIGATION_BRIDGE_NOT_READY',
    };
  },
};

/**
 * Phase 4 completion §6 - page-aware: only acts where a real reset path
 * actually exists (Dashboard: back to its real default bucket; Reports: back
 * to its real default category/stage/dates). Any other current page honestly
 * reports NOT_AVAILABLE rather than pretending to reset something that isn't
 * there - this is NOT a catch-all "do anything" tool, it only ever performs
 * one of these two known, explicit resets, chosen by context.currentPage.
 */
const resetCurrentViewFilters: ToolDefinition = {
  toolName: 'resetCurrentViewFilters',
  descriptionAr: 'إعادة ضبط فلاتر الشاشة الحالية إلى الوضع الافتراضي (لوحة التحكم أو التقارير فقط)',
  descriptionEn: 'Reset the current screen\'s filters to their defaults (Dashboard or Reports only)',
  commandType: 'ACTION',
  riskLevel: 'LOW_RISK',
  confirmationPolicy: 'NONE',
  requiredPermission: ['dashboard.view', 'reports.view'],
  parameterSchema: NO_PARAMS_SCHEMA,
  inputSchema: () => ({ valid: true, value: {} }),
  execute: async (_input, context) => {
    if (context.currentPage === 'dashboard') {
      window.dispatchEvent(new Event(DASHBOARD_FILTER_RESET_EVENT));
      return { success: true, data: { page: 'dashboard' }, messageAr: 'تمت إعادة ضبط فلاتر لوحة التحكم.', messageEn: 'Dashboard filters reset.' };
    }
    if (context.currentPage === 'reports') {
      window.dispatchEvent(new Event(REPORT_RESET_EVENT));
      return { success: true, data: { page: 'reports' }, messageAr: 'تمت إعادة ضبط فلاتر التقارير.', messageEn: 'Report filters reset.' };
    }
    return {
      success: false,
      errorCode: 'FILTER_NOT_SUPPORTED',
      messageAr: 'لا توجد فلاتر قابلة لإعادة الضبط في هذه الشاشة.',
      messageEn: 'This screen has no resettable filters.',
    };
  },
};

/**
 * Phase 4 completion §5, updated by the Dashboard Capability Upgrade -
 * page-aware: both Reports and the Dashboard are now one-time
 * fetchUniversalStageRecords() loads (see DashboardView.tsx's top comment
 * for why the Dashboard's old live onSnapshot subscription was replaced),
 * so both get a REAL re-fetch here - no more "already live" no-op for
 * Dashboard now that that claim would no longer be true.
 */
const refreshCurrentView: ToolDefinition = {
  toolName: 'refreshCurrentView',
  descriptionAr: 'إعادة تحميل بيانات الشاشة الحالية (لوحة التحكم أو التقارير)',
  descriptionEn: "Reload the current screen's data (Dashboard or Reports)",
  commandType: 'ACTION',
  riskLevel: 'LOW_RISK',
  confirmationPolicy: 'NONE',
  requiredPermission: ['dashboard.view', 'reports.view'],
  parameterSchema: NO_PARAMS_SCHEMA,
  inputSchema: () => ({ valid: true, value: {} }),
  execute: async (_input, context) => {
    if (context.currentPage === 'reports') {
      window.dispatchEvent(new Event(REPORT_REFRESH_EVENT));
      return { success: true, data: { page: 'reports' }, messageAr: 'تم تحديث بيانات التقرير.', messageEn: 'Report data refreshed.' };
    }
    if (context.currentPage === 'dashboard') {
      window.dispatchEvent(new Event(DASHBOARD_REFRESH_EVENT));
      return { success: true, data: { page: 'dashboard' }, messageAr: 'تم تحديث بيانات لوحة التحكم.', messageEn: 'Dashboard data refreshed.' };
    }
    return {
      success: false,
      errorCode: 'REFRESH_NOT_SUPPORTED',
      messageAr: 'لا يوجد إجراء تحديث فعلي في هذه الشاشة.',
      messageEn: 'This screen has no real refresh action.',
    };
  },
};

/**
 * Phase 4 completion §4 - "افتح المكبس 2000"/"افتح العربة 209"/"افتح العميل
 * شركة النور"/"افتح الموظف الأول" (resolved to a name from a prior ranking
 * result). Reuses findMasterDataMatches() - the EXACT SAME lookup
 * searchMasterData already uses - then navigates to Master Data and
 * highlights the match via the SAME session-local handoff pattern as
 * openReportView/REPORT_PREFILL_KEY. Deliberately does NOT auto-open the
 * edit modal - "open"/"show" is not "edit", and editing master data stays
 * governed entirely by Phase 2's own tools/confirmation flow.
 */
const openMasterDataRecord: ToolDefinition = {
  toolName: 'openMasterDataRecord',
  descriptionAr: 'البحث عن عنصر بيانات أساسية محدد وفتح شاشة البيانات الأساسية مع تمييزه',
  descriptionEn: 'Search for a specific master data record and open Master Data with it highlighted',
  commandType: 'NAVIGATION',
  riskLevel: 'LOW_RISK',
  confirmationPolicy: 'NONE',
  requiredPermission: ['masterdata.view'],
  parameterSchema: OPEN_MASTER_DATA_RECORD_SCHEMA,
  inputSchema: (input) => {
    const domain = String(input?.domain || '').trim();
    const collectionName = (MASTER_DATA_COLLECTIONS as Record<string, string>)[domain];
    const query = String(input?.query || '').trim();
    if (!collectionName || !query) {
      return { valid: false, errors: ['domain and a non-empty query are required'] };
    }
    return { valid: true, value: { domain, collectionName, query: query.toLowerCase() } };
  },
  execute: async (input, context) => {
    if (!canAccessPage(syntheticUserFromContext(context), 'master-data')) {
      return {
        success: false,
        errorCode: 'PAGE_ACCESS_DENIED',
        messageAr: 'عفواً، لا تملك الصلاحية لفتح شاشة البيانات الأساسية.',
        messageEn: 'Sorry, you do not have permission to open Master Data.',
      };
    }

    const label = (m: any) => `${m.name || m.carNumber || m.code || '?'} (${m.code || m.carNumber || '-'})`;
    const resolved = await resolveSingleMasterDataMatch(input.collectionName, input.query, {
      notFoundAr: `لم يتم العثور على أي عنصر مطابق لـ "${input.query}".`,
      notFoundEn: `No record matching "${input.query}" was found.`,
      ambiguousPrefixAr: 'يوجد أكثر من عنصر مطابق: ',
      ambiguousPrefixEn: 'More than one record matches: ',
      ambiguousSuffixAr: '. أي واحد تقصد؟',
      ambiguousSuffixEn: '. Which one do you mean?',
      labelFn: label,
    });
    if (resolved.outcome !== 'FOUND') return resolved.result;

    const match = resolved.match;
    const prefill: MasterDataPrefill = { tab: input.domain as MasterDataTab, query: (match.code || match.carNumber || match.name || '').toString() };
    try {
      sessionStorage.setItem(MASTER_DATA_PREFILL_KEY, JSON.stringify(prefill));
    } catch {
      // Live event below still covers the "already on Master Data" case.
    }
    window.dispatchEvent(new CustomEvent(MASTER_DATA_PREFILL_EVENT, { detail: prefill }));
    const dispatched = requestNavigation('master-data');

    return {
      success: dispatched,
      data: { page: 'master-data', domain: input.domain, match: { code: match.code, name: match.name, carNumber: match.carNumber } },
      messageAr: dispatched ? `وجدت ${label(match)} وفتحته في شاشة البيانات الأساسية.` : 'تعذر فتح الشاشة حالياً - أعد المحاولة خلال لحظات.',
      messageEn: dispatched ? `Found ${label(match)} and opened it in Master Data.` : 'Unable to open the screen right now - please try again in a moment.',
      errorCode: dispatched ? undefined : 'NAVIGATION_BRIDGE_NOT_READY',
    };
  },
};

export function registerNavigationTools(): void {
  [
    navigateToPage,
    openReportView,
    setDashboardDateFilter,
    setDashboardStageFilter,
    setDashboardShiftFilter,
    setDashboardEntityFilter,
    setDashboardSort,
    resetCurrentViewFilters,
    refreshCurrentView,
    openMasterDataRecord,
  ].forEach(registerTool);
}

/**
 * Phase 4B - AI control of EXISTING custom dashboards + interactive chart
 * choices + new-dashboard creation. Every write here goes through the SAME
 * pipeline as every other Phase 4 tool (Permission Guard -> validation ->
 * the Dashboard Builder's OWN handlers via CUSTOM_DASHBOARD_ACTION_EVENT,
 * see DashboardBuilderView.tsx's top comment) - never a second dashboard
 * engine, never a direct Firestore/localStorage write from a tool.
 *
 * Widget resolution deliberately reads from the LIVE ScreenContext summary
 * DashboardBuilderView publishes (context.selectedFilters.widgets), never
 * from dashboardPersistenceService directly - the persisted copy can be
 * stale the moment the user has an unsaved edit open, and Part 15 requires
 * exactly ONE authoritative state, not an AI shadow copy that could diverge.
 */
import { ToolDefinition } from '../types';
import { registerTool } from './registry';
import { canAccessPage } from '../../utils/permissions';
import { requestNavigation } from '../navigationBridge';
import { syntheticUserFromContext } from '../permissionGuard';
import {
  USE_CUSTOM_DASHBOARD_SCHEMA,
  SET_CUSTOM_DASHBOARD_FILTERS_SCHEMA,
  SET_CUSTOM_DASHBOARD_WIDGET_SCHEMA,
  CREATE_CUSTOM_DASHBOARD_SCHEMA,
  SAVE_CUSTOM_DASHBOARD_CHANGES_SCHEMA,
} from './parameterSchemas';
import { listDashboards } from '../../services/dashboardPersistenceService';
import {
  DashboardLayout, DashboardSection, GlobalDashboardFilters, ALL_STAGES, ALL_CHART_TYPES,
  CHART_TYPE_LABELS, recommendChartType,
} from '../../services/dashboardRegistry';
import { resolveDashboardRef, buildWidgetTargetChoiceRequest, buildChartTypeChoiceRequest, widgetDisplayLabel } from '../../services/customDashboardAiBridge';
import { proposeDashboardConfig } from '../../services/aiDashboardDesigner';
import { resolveSingleMasterDataMatch } from './masterDataTools';
import {
  CUSTOM_DASHBOARD_PREFILL_KEY, CUSTOM_DASHBOARD_PREFILL_EVENT, CUSTOM_DASHBOARD_ACTION_EVENT,
  CustomDashboardAction, CustomDashboardPrefill,
} from '../../components/dashboard/DashboardBuilderView';

interface PublishedWidgetSummary {
  widgetId: string;
  label: string;
  chartType: string;
  metric: string;
  entityType?: string;
  analysisMode: string;
  limit?: number;
  secondaryMetricsCount: number;
  rankingDirection?: 'best' | 'worst';
}

interface PublishedDashboardContext {
  dashboardId: string;
  dashboardNumber?: number;
  dashboardName?: string;
  dashboardOwner?: string;
  editable: boolean;
  filters?: GlobalDashboardFilters;
  widgets: PublishedWidgetSummary[];
  selectedWidgetId?: string | null;
}

/** Part 3 §4 - reads the currently-open custom dashboard's live context, published by DashboardBuilderView.tsx. Returns null when no custom dashboard is open (a different screen, or classic Dashboard mode). */
function currentDashboardContext(context: any): PublishedDashboardContext | null {
  const sel = context.selectedFilters;
  if (context.selectedEntityType !== 'customDashboard' || !sel?.dashboardId) return null;
  return sel as PublishedDashboardContext;
}

function genSectionId(): string { return `sec_ai_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`; }

function buildDraftLayout(
  input: { name?: string; description?: string },
  language: 'ar' | 'en'
): { layout: Omit<DashboardLayout, 'dashboardId' | 'dashboardNumber' | 'createdAt' | 'updatedAt'>; summaryAr: string; summaryEn: string; defaultsUsed: string[] } {
  if (input.description) {
    const proposal = proposeDashboardConfig(input.description, language);
    const name = input.name || (language === 'ar' ? `لوحة: ${input.description.slice(0, 30)}` : `Dashboard: ${input.description.slice(0, 30)}`);
    return { layout: { name, sections: proposal.sections }, summaryAr: proposal.explanationAr, summaryEn: proposal.explanationEn, defaultsUsed: proposal.defaultsUsed };
  }
  const name = input.name || (language === 'ar' ? 'لوحة جديدة' : 'New Dashboard');
  const sections: DashboardSection[] = [{ sectionId: genSectionId(), title: name, columns: 3, widgets: [] }];
  return {
    layout: { name, sections },
    summaryAr: 'لوحة فارغة جديدة - يمكن إضافة عناصر إليها لاحقًا من داخل منشئ اللوحات.',
    summaryEn: 'A new blank dashboard - widgets can be added later from inside the Dashboard Builder.',
    defaultsUsed: [],
  };
}

/**
 * Part 1/Part 2 - "استخدم اللوحة رقم 1"/"افتح اللوحة رقم 1"/"عدل لوحة
 * الإنتاج". Omitting both dashboardNumber/dashboardName lists the saved
 * dashboards instead (discovery, §1). Reuses the EXACT session-local
 * handoff (prefill key + live event + requestNavigation) openReportView/
 * openMasterDataRecord already use - the third consumer of an established
 * pattern, not a new mechanism.
 */
const useCustomDashboard: ToolDefinition = {
  toolName: 'useCustomDashboard',
  descriptionAr: 'فتح لوحة معلومات مخصصة محفوظة برقمها أو اسمها، أو عرض قائمة اللوحات المحفوظة عند عدم تحديد أي منهما',
  descriptionEn: 'Open a saved custom dashboard by number or name, or list saved dashboards when neither is given',
  commandType: 'NAVIGATION',
  riskLevel: 'LOW_RISK',
  confirmationPolicy: 'NONE',
  requiredPermission: ['dashboard.view'],
  parameterSchema: USE_CUSTOM_DASHBOARD_SCHEMA,
  inputSchema: (input) => {
    const dashboardNumber = input?.dashboardNumber !== undefined && input?.dashboardNumber !== null && input?.dashboardNumber !== '' ? Number(input.dashboardNumber) : undefined;
    const dashboardName = input?.dashboardName ? String(input.dashboardName).trim() : undefined;
    return { valid: true, value: { dashboardNumber, dashboardName } };
  },
  execute: async (input, context) => {
    if (!canAccessPage(syntheticUserFromContext(context), 'dashboard')) {
      return {
        success: false,
        errorCode: 'PAGE_ACCESS_DENIED',
        messageAr: 'عفواً، لا تملك الصلاحية لعرض لوحة التحكم.',
        messageEn: 'Sorry, you do not have permission to view the Dashboard.',
      };
    }

    const dashboards = listDashboards();

    if (input.dashboardNumber === undefined && !input.dashboardName) {
      if (dashboards.length === 0) {
        return { success: true, data: { dashboards: [] }, messageAr: 'لا توجد لوحات مخصصة محفوظة بعد.', messageEn: 'No saved custom dashboards yet.' };
      }
      return {
        success: true,
        data: { dashboards: dashboards.map((d) => ({ dashboardNumber: d.dashboardNumber, name: d.name, owner: d.ownerName, updatedAt: d.updatedAt })) },
        messageAr: `اللوحات المحفوظة: ${dashboards.map((d) => `لوحة ${d.dashboardNumber}: ${d.name}`).join('، ')}`,
        messageEn: `Saved dashboards: ${dashboards.map((d) => `Dashboard ${d.dashboardNumber}: ${d.name}`).join(', ')}`,
      };
    }

    const resolved = resolveDashboardRef({ dashboardNumber: input.dashboardNumber, dashboardName: input.dashboardName }, dashboards);
    if (resolved.outcome === 'NOT_FOUND') {
      return { success: false, errorCode: 'NOT_FOUND', messageAr: 'لم يتم العثور على لوحة مطابقة.', messageEn: 'No matching dashboard was found.' };
    }
    if (resolved.outcome === 'AMBIGUOUS') {
      return {
        success: false,
        errorCode: 'AMBIGUOUS_DASHBOARD',
        data: { candidates: resolved.candidates.map((d) => ({ dashboardNumber: d.dashboardNumber, name: d.name })) },
        messageAr: `يوجد أكثر من لوحة مطابقة: ${resolved.candidates.map((d) => `لوحة ${d.dashboardNumber}: ${d.name}`).join('، ')}. أي واحدة تقصد؟`,
        messageEn: `More than one dashboard matches: ${resolved.candidates.map((d) => `Dashboard ${d.dashboardNumber}: ${d.name}`).join(', ')}. Which one do you mean?`,
      };
    }

    const dash = resolved.dashboard;
    const prefill: CustomDashboardPrefill = { dashboardId: dash.dashboardId };
    try { sessionStorage.setItem(CUSTOM_DASHBOARD_PREFILL_KEY, JSON.stringify(prefill)); } catch { /* the live events below still cover the already-mounted cases */ }
    window.dispatchEvent(new CustomEvent(CUSTOM_DASHBOARD_PREFILL_EVENT, { detail: prefill }));
    window.dispatchEvent(new CustomEvent(CUSTOM_DASHBOARD_ACTION_EVENT, { detail: { type: 'SELECT_DASHBOARD', dashboardId: dash.dashboardId } as CustomDashboardAction }));
    const dispatched = requestNavigation('dashboard');

    return {
      success: dispatched,
      data: { dashboardId: dash.dashboardId, dashboardNumber: dash.dashboardNumber, name: dash.name },
      messageAr: dispatched ? `تم فتح لوحة ${dash.dashboardNumber}: ${dash.name}.` : 'تعذر فتح اللوحة حالياً - أعد المحاولة خلال لحظات.',
      messageEn: dispatched ? `Opened Dashboard ${dash.dashboardNumber}: ${dash.name}.` : 'Unable to open the dashboard right now - please try again in a moment.',
      errorCode: dispatched ? undefined : 'NAVIGATION_BRIDGE_NOT_READY',
    };
  },
};

const TIME_RANGE_PRESETS = ['TODAY', 'YESTERDAY', 'THIS_WEEK', 'LAST_WEEK', 'LAST_7_DAYS', 'THIS_MONTH', 'LAST_MONTH', 'LAST_30_DAYS', 'LAST_3_MONTHS', 'LAST_6_MONTHS', 'THIS_YEAR', 'ALL_TIME', 'NAMED_MONTH', 'CUSTOM'];
const ENTITY_FIELD_TO_COLLECTION: Record<string, string> = { shift: 'shifts', employee: 'employees', press: 'presses', product: 'products', customer: 'customers' };
const ENTITY_FIELD_TO_FILTER_KEY: Record<string, keyof GlobalDashboardFilters> = { shift: 'shiftId', employee: 'employeeId', press: 'pressId', product: 'productId', customer: 'customerId' };
const ENTITY_FIELD_LABEL_AR: Record<string, string> = { shift: 'الوردية', employee: 'الموظف', press: 'المكبس', product: 'المنتج', customer: 'العميل' };
const ENTITY_FIELD_LABEL_EN: Record<string, string> = { shift: 'shift', employee: 'employee', press: 'press', product: 'product', customer: 'customer' };

/**
 * Part 3/§5-6 - edits the CURRENTLY OPEN dashboard's TEMPORARY (unsaved)
 * filters - the SAME GlobalDashboardFilters the Live Control Bar itself
 * uses. This is view-only state (Part 5 CRITICAL) until saveCustomDashboardChanges
 * is explicitly called - never silently persisted.
 */
const setCustomDashboardFilters: ToolDefinition = {
  toolName: 'setCustomDashboardFilters',
  descriptionAr: 'تعديل فلاتر اللوحة المخصصة المفتوحة حاليًا (فترة/مرحلة/وردية/كيان) - تعديل مؤقت غير محفوظ',
  descriptionEn: "Edit the currently open custom dashboard's filters (period/stage/shift/entity) - a temporary, unsaved change",
  commandType: 'ACTION',
  riskLevel: 'LOW_RISK',
  confirmationPolicy: 'NONE',
  requiredPermission: ['dashboard.manageCustomDashboards'],
  parameterSchema: SET_CUSTOM_DASHBOARD_FILTERS_SCHEMA,
  inputSchema: (input) => {
    if (input?.timeRangePreset && !TIME_RANGE_PRESETS.includes(input.timeRangePreset)) {
      return { valid: false, errors: [`timeRangePreset must be one of: ${TIME_RANGE_PRESETS.join(', ')}`] };
    }
    if (input?.timeRangePreset === 'CUSTOM' && (!input?.startDate || !input?.endDate)) {
      return { valid: false, errors: ['startDate and endDate are required when timeRangePreset="CUSTOM"'] };
    }
    if (input?.timeRangePreset === 'CUSTOM' && input?.startDate && input?.endDate && String(input.endDate) < String(input.startDate)) {
      return { valid: false, errors: ['endDate must not be before startDate'] };
    }
    if (input?.timeRangePreset === 'NAMED_MONTH' && (!input?.month || !input?.year)) {
      return { valid: false, errors: ['month and year are required when timeRangePreset="NAMED_MONTH"'] };
    }
    if (input?.stageType && input.stageType !== 'all' && !ALL_STAGES.includes(input.stageType)) {
      return { valid: false, errors: [`stageType must be "all" or one of: ${ALL_STAGES.join(', ')}`] };
    }
    return { valid: true, value: input || {} };
  },
  execute: async (input, context) => {
    const dash = currentDashboardContext(context);
    if (!dash) {
      return { success: false, errorCode: 'NO_DASHBOARD_OPEN', messageAr: 'لا توجد لوحة مخصصة مفتوحة حالياً - افتح لوحة أولاً.', messageEn: 'No custom dashboard is currently open - open one first.' };
    }
    if (!dash.editable) {
      return { success: false, errorCode: 'PAGE_ACCESS_DENIED', messageAr: 'عفواً، لا تملك صلاحية تعديل هذه اللوحة.', messageEn: 'Sorry, you do not have permission to edit this dashboard.' };
    }

    const patch: Partial<GlobalDashboardFilters> = {};
    const partsAr: string[] = [];
    const partsEn: string[] = [];

    if (input.timeRangePreset) {
      patch.timeRangePreset = input.timeRangePreset;
      if (input.timeRangePreset === 'CUSTOM') { patch.customStart = input.startDate; patch.customEnd = input.endDate; }
      if (input.timeRangePreset === 'NAMED_MONTH') { patch.namedMonth = { year: input.year, month: input.month }; }
      partsAr.push(`الفترة: ${input.timeRangePreset}`);
      partsEn.push(`period: ${input.timeRangePreset}`);
    }
    /*
     * Compatibility: production stage is no longer a dashboard-level filter on
     * a custom dashboard - the cost-centre hierarchy is the organisational
     * filter, and the dashboard normalises any stage back to all stages. So a
     * stage request is never reported as applied; the assistant says where
     * stage lives now instead of claiming a filter the screen does not show.
     */
    const stageNotApplicable = !!input.stageType && input.stageType !== 'all';
    const stageNoteAr = 'المرحلة لم تعد فلترًا على مستوى اللوحة المخصصة - استخدم «مراكز التكاليف»، أو اضبط مرحلة العنصر نفسه من إعداداته.';
    const stageNoteEn = 'Stage is no longer a dashboard-level filter on custom dashboards - use "Cost centres", or set the stage on the widget itself in its settings.';
    for (const field of ['shift', 'employee', 'press', 'product', 'customer'] as const) {
      if (input[field] === undefined) continue;
      const filterKey = ENTITY_FIELD_TO_FILTER_KEY[field];
      if (input[field] === '') {
        (patch as any)[filterKey] = undefined;
        partsAr.push(`${ENTITY_FIELD_LABEL_AR[field]}: (تمت الإزالة)`);
        partsEn.push(`${ENTITY_FIELD_LABEL_EN[field]}: (cleared)`);
        continue;
      }
      const resolved = await resolveSingleMasterDataMatch(ENTITY_FIELD_TO_COLLECTION[field], String(input[field]).toLowerCase(), {
        notFoundAr: `لم يتم العثور على ${ENTITY_FIELD_LABEL_AR[field]} مطابق لـ "${input[field]}".`,
        notFoundEn: `No ${ENTITY_FIELD_LABEL_EN[field]} matching "${input[field]}" was found.`,
        ambiguousPrefixAr: `يوجد أكثر من ${ENTITY_FIELD_LABEL_AR[field]} مطابق: `,
        ambiguousPrefixEn: `More than one ${ENTITY_FIELD_LABEL_EN[field]} matches: `,
        ambiguousSuffixAr: '. أي واحد تقصد؟',
        ambiguousSuffixEn: '. Which one do you mean?',
      });
      if (resolved.outcome !== 'FOUND') return resolved.result;
      (patch as any)[filterKey] = resolved.match.id;
      partsAr.push(`${ENTITY_FIELD_LABEL_AR[field]}: ${resolved.match.name || resolved.match.code}`);
      partsEn.push(`${ENTITY_FIELD_LABEL_EN[field]}: ${resolved.match.name || resolved.match.code}`);
    }

    if (Object.keys(patch).length === 0) {
      if (stageNotApplicable) {
        return { success: false, errorCode: 'INVALID_REQUEST', messageAr: stageNoteAr, messageEn: stageNoteEn };
      }
      return { success: false, errorCode: 'INVALID_REQUEST', messageAr: 'لم يتم تحديد أي فلتر لتطبيقه.', messageEn: 'No filter was specified to apply.' };
    }

    window.dispatchEvent(new CustomEvent(CUSTOM_DASHBOARD_ACTION_EVENT, { detail: { type: 'SET_FILTERS', patch } as CustomDashboardAction }));
    return {
      success: true,
      data: { dashboardId: dash.dashboardId, patch },
      messageAr: `تم تطبيق الفلاتر على لوحة ${dash.dashboardNumber}: ${partsAr.join('، ')}.${stageNotApplicable ? ` ${stageNoteAr}` : ''}`,
      messageEn: `Applied filters to Dashboard ${dash.dashboardNumber}: ${partsEn.join(', ')}.${stageNotApplicable ? ` ${stageNoteEn}` : ''}`,
    };
  },
};

/**
 * Part 4 §7-14/§21-22 - changes ONE widget's chart type and/or ranking
 * direction on the currently open dashboard. Three distinct outcomes,
 * never a silent guess: (1) ambiguous/missing target -> an interactive
 * "which chart?" choice: (2) no chartType/rankingDirection given at all ->
 * an interactive chart-TYPE choice (recommendation shown, never
 * auto-applied - §11); (3) both resolved -> applies immediately (§12 - the
 * real chart changes, this is a temporary/unsaved edit like any other,
 * per Part 5).
 */
const setCustomDashboardWidget: ToolDefinition = {
  toolName: 'setCustomDashboardWidget',
  descriptionAr: 'تغيير شكل الرسم و/أو اتجاه الترتيب لعنصر محدد في اللوحة المخصصة المفتوحة - قد يعرض خيارات تفاعلية بدلاً من التطبيق المباشر',
  descriptionEn: "Change a specific widget's chart type and/or ranking direction on the currently open custom dashboard - may return interactive choices instead of applying directly",
  commandType: 'ACTION',
  riskLevel: 'LOW_RISK',
  confirmationPolicy: 'NONE',
  requiredPermission: ['dashboard.manageCustomDashboards'],
  parameterSchema: SET_CUSTOM_DASHBOARD_WIDGET_SCHEMA,
  inputSchema: (input) => {
    if (input?.chartType && !ALL_CHART_TYPES.includes(input.chartType)) {
      return { valid: false, errors: [`chartType must be one of: ${ALL_CHART_TYPES.join(', ')}`] };
    }
    if (input?.rankingDirection && !['best', 'worst'].includes(input.rankingDirection)) {
      return { valid: false, errors: ['rankingDirection must be "best" or "worst"'] };
    }
    return {
      valid: true,
      value: {
        widgetId: input?.widgetId ? String(input.widgetId) : undefined,
        widgetLabel: input?.widgetLabel ? String(input.widgetLabel).trim() : undefined,
        chartType: input?.chartType,
        rankingDirection: input?.rankingDirection,
      },
    };
  },
  execute: async (input, context) => {
    const dash = currentDashboardContext(context);
    if (!dash) {
      return { success: false, errorCode: 'NO_DASHBOARD_OPEN', messageAr: 'لا توجد لوحة مخصصة مفتوحة حالياً - افتح لوحة أولاً.', messageEn: 'No custom dashboard is currently open - open one first.' };
    }
    if (!dash.editable) {
      return { success: false, errorCode: 'PAGE_ACCESS_DENIED', messageAr: 'عفواً، لا تملك صلاحية تعديل هذه اللوحة.', messageEn: 'Sorry, you do not have permission to edit this dashboard.' };
    }

    const widgets = dash.widgets || [];
    const fingerprint = dash.dashboardId;

    let resolvedWidget: PublishedWidgetSummary | null = null;
    if (input.widgetId) {
      resolvedWidget = widgets.find((w) => w.widgetId === input.widgetId) || null;
    } else if (input.widgetLabel) {
      const q = input.widgetLabel.toLowerCase();
      const matches = widgets.filter((w) => w.label.toLowerCase().includes(q) || q.includes(w.label.toLowerCase()));
      if (matches.length === 1) resolvedWidget = matches[0];
      else if (matches.length > 1) {
        const choice = buildWidgetTargetChoiceRequest(matches.map((w) => ({ widgetId: w.widgetId, label: w.label })), 'setCustomDashboardWidget', { chartType: input.chartType, rankingDirection: input.rankingDirection }, fingerprint);
        return { success: true, choiceRequest: choice, messageAr: 'أي رسم تريد تغييره؟', messageEn: 'Which chart do you want to change?' };
      }
    } else if (dash.selectedWidgetId) {
      resolvedWidget = widgets.find((w) => w.widgetId === dash.selectedWidgetId) || null;
    } else if (widgets.length === 1) {
      resolvedWidget = widgets[0];
    }

    if (!resolvedWidget) {
      if (widgets.length === 0) {
        return { success: false, errorCode: 'NOT_FOUND', messageAr: 'لا توجد عناصر رسم بيانية في هذه اللوحة.', messageEn: 'This dashboard has no chart widgets.' };
      }
      const choice = buildWidgetTargetChoiceRequest(widgets.map((w) => ({ widgetId: w.widgetId, label: w.label })), 'setCustomDashboardWidget', { chartType: input.chartType, rankingDirection: input.rankingDirection }, fingerprint);
      return { success: true, choiceRequest: choice, messageAr: 'أي رسم تريد تغييره؟', messageEn: 'Which chart do you want to change?' };
    }

    // §9-11 - "غير شكل الرسم" with no explicit type: show real options, never auto-apply.
    if (!input.chartType && !input.rankingDirection) {
      const recommended = recommendChartType(resolvedWidget.analysisMode as any, { entityCount: resolvedWidget.limit || 10, metricCount: (resolvedWidget.secondaryMetricsCount || 0) + 1 }).chartType;
      const choice = buildChartTypeChoiceRequest(resolvedWidget.widgetId, recommended, context.currentLanguage, {}, fingerprint);
      return {
        success: true,
        choiceRequest: choice,
        messageAr: `اختر شكل الرسم لـ "${resolvedWidget.label}":`,
        messageEn: `Choose the chart type for "${resolvedWidget.label}":`,
      };
    }

    const patch: Record<string, any> = {};
    const partsAr: string[] = [];
    const partsEn: string[] = [];
    if (input.chartType) {
      patch.chartType = input.chartType;
      patch.chartTypeIsOverride = true;
      partsAr.push(`شكل الرسم: ${CHART_TYPE_LABELS[input.chartType as keyof typeof CHART_TYPE_LABELS].ar}`);
      partsEn.push(`chart type: ${CHART_TYPE_LABELS[input.chartType as keyof typeof CHART_TYPE_LABELS].en}`);
    }
    if (input.rankingDirection) {
      patch.rankingDirection = input.rankingDirection;
      partsAr.push(`الترتيب: ${input.rankingDirection === 'best' ? 'الأفضل' : 'الأسوأ'}`);
      partsEn.push(`sort: ${input.rankingDirection}`);
    }

    window.dispatchEvent(new CustomEvent(CUSTOM_DASHBOARD_ACTION_EVENT, { detail: { type: 'SET_WIDGET', widgetId: resolvedWidget.widgetId, patch } as CustomDashboardAction }));
    return {
      success: true,
      data: { widgetId: resolvedWidget.widgetId },
      messageAr: `تم تحديث "${resolvedWidget.label}" (${partsAr.join('، ')}).`,
      messageEn: `Updated "${resolvedWidget.label}" (${partsEn.join(', ')}).`,
    };
  },
};

/**
 * Part 5 §15-19 - creates a NEW custom dashboard from a natural-language
 * description (reuses proposeDashboardConfig(), the SAME function the
 * existing in-Builder "AI Report Designer" panel uses) or a blank starter
 * dashboard when no description is given. Always confirmed first
 * (confirmationPolicy ALWAYS reuses the EXISTING ActionPreview
 * Apply/Cancel card - §18/§19, no new confirmation UI needed). Never
 * overwrites an existing dashboardNumber (§15/CRITICAL).
 */
const createCustomDashboard: ToolDefinition = {
  toolName: 'createCustomDashboard',
  descriptionAr: 'إنشاء لوحة معلومات مخصصة جديدة (كمسودة تُعرض للمعاينة قبل الحفظ)',
  descriptionEn: 'Create a new custom dashboard (as a draft previewed before saving)',
  commandType: 'ACTION',
  riskLevel: 'MEDIUM_RISK',
  confirmationPolicy: 'ALWAYS',
  requiredPermission: ['dashboard.manageCustomDashboards'],
  parameterSchema: CREATE_CUSTOM_DASHBOARD_SCHEMA,
  inputSchema: (input) => {
    const dashboardNumber = input?.dashboardNumber !== undefined && input?.dashboardNumber !== null && input?.dashboardNumber !== '' ? Number(input.dashboardNumber) : undefined;
    return {
      valid: true,
      value: {
        name: input?.name ? String(input.name).trim() : undefined,
        dashboardNumber,
        description: input?.description ? String(input.description).trim() : undefined,
      },
    };
  },
  buildPreview: async (input, context) => {
    const language = context.currentLanguage;
    if (input.dashboardNumber !== undefined) {
      const existing = listDashboards().find((d) => d.dashboardNumber === input.dashboardNumber);
      if (existing) {
        return {
          targetSummaryAr: `اللوحة رقم ${input.dashboardNumber} موجودة بالفعل ("${existing.name}") - لن يتم إنشاء لوحة جديدة بنفس الرقم.`,
          targetSummaryEn: `Dashboard ${input.dashboardNumber} already exists ("${existing.name}") - a new dashboard with the same number will not be created.`,
          items: [{ key: 'exists', displayValue: `#${input.dashboardNumber}`, status: 'ALREADY_EXISTS', messageAr: 'استخدم "استخدم اللوحة رقم N" لفتحها بدلاً من ذلك.', messageEn: 'Use "open dashboard N" to open it instead.' }],
        };
      }
    }
    const { layout, summaryAr, summaryEn, defaultsUsed } = buildDraftLayout(input, language);
    const widgetCount = layout.sections.reduce((s, sec) => s + sec.widgets.length, 0);
    const widgetList = layout.sections.flatMap((s) => s.widgets).map((w) => widgetDisplayLabel(w, language)).join('، ');
    return {
      targetSummaryAr: `${layout.name} - ${widgetCount} عنصر${widgetList ? `: ${widgetList}` : ''}. ${summaryAr}${defaultsUsed.length ? ` (${defaultsUsed.join('؛ ')})` : ''}`,
      targetSummaryEn: `${layout.name} - ${widgetCount} widget(s)${widgetList ? `: ${widgetList}` : ''}. ${summaryEn}${defaultsUsed.length ? ` (${defaultsUsed.join('; ')})` : ''}`,
      items: [{ key: 'draft', displayValue: layout.name, status: 'NEW', messageAr: 'سيتم إنشاء هذه اللوحة عند التأكيد.', messageEn: 'This dashboard will be created upon confirmation.' }],
    };
  },
  execute: async (input, context) => {
    if (input.dashboardNumber !== undefined) {
      const existing = listDashboards().find((d) => d.dashboardNumber === input.dashboardNumber);
      if (existing) {
        return {
          success: false,
          errorCode: 'DASHBOARD_NUMBER_TAKEN',
          messageAr: `اللوحة رقم ${input.dashboardNumber} موجودة بالفعل باسم "${existing.name}" - لم يتم إنشاء لوحة جديدة.`,
          messageEn: `Dashboard ${input.dashboardNumber} already exists as "${existing.name}" - no new dashboard was created.`,
        };
      }
    }
    const { layout } = buildDraftLayout(input, context.currentLanguage);
    window.dispatchEvent(new CustomEvent(CUSTOM_DASHBOARD_ACTION_EVENT, { detail: { type: 'CREATE_DASHBOARD', layout } as CustomDashboardAction }));
    const dispatched = requestNavigation('dashboard');
    return {
      success: true,
      data: { name: layout.name },
      messageAr: dispatched ? `تم إنشاء لوحة "${layout.name}" وفتحها.` : `تم إنشاء لوحة "${layout.name}" - افتح شاشة لوحة التحكم لعرضها.`,
      messageEn: dispatched ? `Created and opened "${layout.name}".` : `Created "${layout.name}" - open the Dashboard screen to view it.`,
    };
  },
};

/**
 * Part 5-6 §6/§10-11 - persists the CURRENTLY OPEN dashboard's on-screen
 * state (including any temporary filter/widget edits applied above) as its
 * real saved configuration. Always confirmed first (§18/§19 - reuses the
 * SAME existing ActionPreview Apply/Cancel card). A temporary view change is
 * NEVER auto-persisted - only this explicit tool call writes it (Part 5
 * CRITICAL).
 */
const saveCustomDashboardChanges: ToolDefinition = {
  toolName: 'saveCustomDashboardChanges',
  descriptionAr: 'حفظ التعديلات المؤقتة الحالية على اللوحة المخصصة المفتوحة كتكوين دائم',
  descriptionEn: "Persist the currently open custom dashboard's temporary edits as its real saved configuration",
  commandType: 'ACTION',
  riskLevel: 'MEDIUM_RISK',
  confirmationPolicy: 'ALWAYS',
  requiredPermission: ['dashboard.manageCustomDashboards'],
  parameterSchema: SAVE_CUSTOM_DASHBOARD_CHANGES_SCHEMA,
  inputSchema: (input) => ({ valid: true, value: { asDefaultFilters: !!input?.asDefaultFilters } }),
  buildPreview: async (input, context) => {
    const dash = currentDashboardContext(context);
    const name = dash?.dashboardName || (context.currentLanguage === 'ar' ? 'اللوحة الحالية' : 'the current dashboard');
    return {
      targetSummaryAr: `سيتم حفظ التعديلات الحالية على لوحة "${name}"${input.asDefaultFilters ? ' بما في ذلك الفلاتر الحالية كافتراضية جديدة' : ''}.`,
      targetSummaryEn: `Current edits on "${name}" will be saved${input.asDefaultFilters ? ', including the current filters as the new default' : ''}.`,
      items: [{ key: 'save', displayValue: name, status: 'NEW', messageAr: 'سيتم حفظ اللوحة عند التأكيد.', messageEn: 'The dashboard will be saved upon confirmation.' }],
    };
  },
  execute: async (input, context) => {
    const dash = currentDashboardContext(context);
    if (!dash) {
      return { success: false, errorCode: 'NO_DASHBOARD_OPEN', messageAr: 'لا توجد لوحة مخصصة مفتوحة حالياً.', messageEn: 'No custom dashboard is currently open.' };
    }
    if (!dash.editable) {
      return { success: false, errorCode: 'PAGE_ACCESS_DENIED', messageAr: 'عفواً، لا تملك صلاحية حفظ هذه اللوحة.', messageEn: 'Sorry, you do not have permission to save this dashboard.' };
    }
    window.dispatchEvent(new CustomEvent(CUSTOM_DASHBOARD_ACTION_EVENT, { detail: { type: 'SAVE_CURRENT', asDefaultFilters: input.asDefaultFilters } as CustomDashboardAction }));
    return {
      success: true,
      data: { dashboardId: dash.dashboardId },
      messageAr: `تم حفظ لوحة ${dash.dashboardNumber}: ${dash.dashboardName}${input.asDefaultFilters ? ' (شاملاً الفلاتر كافتراضية)' : ''}.`,
      messageEn: `Saved Dashboard ${dash.dashboardNumber}: ${dash.dashboardName}${input.asDefaultFilters ? ' (including filters as default)' : ''}.`,
    };
  },
};

export function registerCustomDashboardTools(): void {
  [useCustomDashboard, setCustomDashboardFilters, setCustomDashboardWidget, createCustomDashboard, saveCustomDashboardChanges].forEach(registerTool);
}

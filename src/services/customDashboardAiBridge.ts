/**
 * Phase 4B - AI <-> Custom Dashboard Builder bridge (pure, dependency-free
 * from Firebase/React). Resolves natural-language dashboard/widget
 * references against the REAL saved DashboardLayout[] (never invents an id),
 * and builds the typed interactive-choice payloads the chat UI renders.
 *
 * This module never touches localStorage or Firestore itself - callers
 * (customDashboardTools.ts) fetch the real dashboard list via
 * dashboardPersistenceService.ts and pass it in, keeping this file trivially
 * unit-testable without a browser/localStorage shim.
 */
import { DashboardLayout, DashboardSection, WidgetConfig, ChartType, ALL_CHART_TYPES, CHART_TYPE_LABELS, METRIC_REGISTRY, recommendChartType } from './dashboardRegistry';
import { AssistantChoiceRequest } from '../assistant/types';

export type DashboardResolveOutcome =
  | { outcome: 'FOUND'; dashboard: DashboardLayout }
  | { outcome: 'AMBIGUOUS'; candidates: DashboardLayout[] }
  | { outcome: 'NOT_FOUND' };

export interface DashboardRef {
  dashboardId?: string;
  dashboardNumber?: number;
  dashboardName?: string;
}

/**
 * "استخدم اللوحة رقم 1" / "افتح اللوحة 1" / "عدل لوحة الإنتاج" - resolves in
 * priority order id > number > name (id/number are exact and unambiguous by
 * construction; name matching tries an exact case-insensitive match first,
 * then falls back to substring matching, and NEVER auto-picks when more than
 * one dashboard matches - Part 2 "Do NOT guess").
 */
export function resolveDashboardRef(ref: DashboardRef, dashboards: DashboardLayout[]): DashboardResolveOutcome {
  if (ref.dashboardId) {
    const found = dashboards.find((d) => d.dashboardId === ref.dashboardId);
    return found ? { outcome: 'FOUND', dashboard: found } : { outcome: 'NOT_FOUND' };
  }
  if (ref.dashboardNumber !== undefined && ref.dashboardNumber !== null) {
    const found = dashboards.find((d) => d.dashboardNumber === ref.dashboardNumber);
    return found ? { outcome: 'FOUND', dashboard: found } : { outcome: 'NOT_FOUND' };
  }
  if (ref.dashboardName) {
    const q = ref.dashboardName.trim().toLowerCase();
    const exact = dashboards.filter((d) => d.name.trim().toLowerCase() === q);
    if (exact.length === 1) return { outcome: 'FOUND', dashboard: exact[0] };
    if (exact.length > 1) return { outcome: 'AMBIGUOUS', candidates: exact };
    const partial = dashboards.filter((d) => d.name.toLowerCase().includes(q));
    if (partial.length === 1) return { outcome: 'FOUND', dashboard: partial[0] };
    if (partial.length > 1) return { outcome: 'AMBIGUOUS', candidates: partial };
    return { outcome: 'NOT_FOUND' };
  }
  return { outcome: 'NOT_FOUND' };
}

export interface WidgetRef {
  widgetId?: string;
  widgetLabel?: string;
}

export interface WidgetLocation {
  sectionId: string;
  widget: WidgetConfig;
}

export type WidgetResolveOutcome =
  | { outcome: 'FOUND'; location: WidgetLocation }
  | { outcome: 'AMBIGUOUS'; candidates: WidgetLocation[] }
  | { outcome: 'NOT_FOUND' };

export function widgetDisplayLabel(widget: WidgetConfig, language: 'ar' | 'en'): string {
  if (widget.customTitle) return widget.customTitle;
  const metricLabel = METRIC_REGISTRY[widget.metric] ? (language === 'ar' ? METRIC_REGISTRY[widget.metric].labelAr : METRIC_REGISTRY[widget.metric].labelEn) : widget.metric;
  return metricLabel;
}

/**
 * Part 4 §13/§14/§21 - "غير شكل الرسم" resolution order: (1) an explicit
 * widgetId, (2) a label/title match against the query text, (3) the
 * currently UI-selected widget (selectedWidgetId, if the caller has one),
 * (4) if the dashboard has exactly ONE widget total, that one (no ambiguity
 * possible), (5) otherwise every widget on the dashboard becomes a candidate
 * for an interactive "which chart?" choice - never a silent guess between
 * two or more real widgets.
 */
export function resolveWidgetRef(ref: WidgetRef, sections: DashboardSection[], selectedWidgetId?: string): WidgetResolveOutcome {
  const all: WidgetLocation[] = sections.flatMap((s) => s.widgets.map((widget) => ({ sectionId: s.sectionId, widget })));

  if (ref.widgetId) {
    const found = all.find((x) => x.widget.widgetId === ref.widgetId);
    return found ? { outcome: 'FOUND', location: found } : { outcome: 'NOT_FOUND' };
  }

  if (ref.widgetLabel) {
    const q = ref.widgetLabel.trim().toLowerCase();
    const matches = all.filter((x) => {
      const label = widgetDisplayLabel(x.widget, 'ar').toLowerCase();
      const labelEn = widgetDisplayLabel(x.widget, 'en').toLowerCase();
      return label.includes(q) || labelEn.includes(q) || q.includes(label) || q.includes(labelEn);
    });
    if (matches.length === 1) return { outcome: 'FOUND', location: matches[0] };
    if (matches.length > 1) return { outcome: 'AMBIGUOUS', candidates: matches };
    // No label match - fall through to selection/count-based resolution below.
  }

  if (selectedWidgetId) {
    const found = all.find((x) => x.widget.widgetId === selectedWidgetId);
    if (found) return { outcome: 'FOUND', location: found };
  }

  if (all.length === 0) return { outcome: 'NOT_FOUND' };
  if (all.length === 1) return { outcome: 'FOUND', location: all[0] };
  return { outcome: 'AMBIGUOUS', candidates: all };
}

function genChoiceRequestId(): string {
  return `choice_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Part 4 §7-10 - "أي رسم تريد تغييره؟" interactive choice, one option per
 * candidate widget. Takes lightweight {widgetId,label} pairs rather than a
 * full WidgetConfig - the tool that calls this resolves widgets against the
 * dashboard's LIVE, published ScreenContext summary (never persistence
 * directly, per Part 15 - "one authoritative state", not a shadow copy that
 * could diverge from the user's currently-open, possibly-unsaved draft).
 */
export function buildWidgetTargetChoiceRequest(
  candidates: Array<{ widgetId: string; label: string }>,
  resolveToolName: string,
  baseArguments: Record<string, any>,
  contextFingerprint: string
): AssistantChoiceRequest {
  return {
    requestId: genChoiceRequestId(),
    questionAr: 'أي رسم تريد تغييره؟',
    questionEn: 'Which chart do you want to change?',
    options: candidates.map((c) => ({ id: c.widgetId, labelAr: c.label, labelEn: c.label })),
    resolution: { toolName: resolveToolName, argKey: 'widgetId', baseArguments },
    contextFingerprint,
  };
}

/** Part 4 §7/§9/§10 - "اختار شكل الرسم المناسب" interactive choice, one option per REAL ChartType (ALL_CHART_TYPES, dashboardRegistry.ts) - never an invented type. The recommended type is flagged in its description; the recommendation is NEVER pre-selected or auto-applied (§11 - clicking is what applies it). */
export function buildChartTypeChoiceRequest(
  widgetId: string,
  recommended: ChartType,
  language: 'ar' | 'en',
  baseArguments: Record<string, any>,
  contextFingerprint: string
): AssistantChoiceRequest {
  return {
    requestId: genChoiceRequestId(),
    questionAr: 'اختر شكل الرسم المناسب:',
    questionEn: 'Choose the chart type:',
    options: ALL_CHART_TYPES.map((ct) => {
      const meta = CHART_TYPE_LABELS[ct];
      const isRec = ct === recommended;
      return {
        id: ct,
        labelAr: meta.ar,
        labelEn: meta.en,
        descriptionAr: isRec ? `${meta.descAr} (موصى به)` : meta.descAr,
        descriptionEn: isRec ? `${meta.descEn} (Recommended)` : meta.descEn,
      };
    }),
    resolution: { toolName: 'setCustomDashboardWidget', argKey: 'chartType', baseArguments: { ...baseArguments, widgetId } },
    contextFingerprint,
  };
}

/** Part 4 §10 - a plain recommendation reason (reused by the read-only "what's the best chart?" reply), reusing the SAME rule table every widget-creation flow already uses - never a second recommendation engine. */
export function recommendWidgetChartType(widget: WidgetConfig): { chartType: ChartType; reasonAr: string; reasonEn: string } {
  return recommendChartType(widget.analysisMode, { entityCount: widget.limit || 10, metricCount: (widget.secondaryMetrics?.length || 0) + 1 });
}

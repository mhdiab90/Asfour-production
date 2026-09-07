/**
 * AI Report Designer tool (§22-24) - exposes the SAME structured proposal
 * function the in-UI "AI Report Designer" panel uses
 * (aiDashboardDesigner.ts's proposeDashboardConfig), so asking the chat
 * assistant to "design me a dashboard" and using the panel inside the
 * Dashboard Builder produce identical, registry-backed results. This tool
 * is pure analysis: it only returns a structured widget proposal (JSON),
 * never applies it to any saved dashboard and never touches Firestore -
 * applying still requires the user to open the Dashboard Builder's
 * Apply/Edit/Cancel preview (§ "AI must never silently apply changes").
 */
import { ToolDefinition } from '../types';
import { registerTool } from './registry';
import { PermissionKey } from '../../types/permissions';
import { proposeDashboardConfig } from '../../services/aiDashboardDesigner';
import { PROPOSE_DASHBOARD_WIDGETS_SCHEMA } from './parameterSchemas';

const READ_PERMISSION: PermissionKey[] = ['dashboard.view', 'reports.view'];

const proposeDashboardWidgets: ToolDefinition = {
  toolName: 'proposeDashboardWidgets',
  descriptionAr: 'اقتراح عناصر لوحة تحكم (رسوم/ترتيب/مقارنة) من وصف نصي، دون تطبيقها تلقائيًا',
  descriptionEn: 'Propose dashboard widgets (charts/ranking/comparison) from a natural-language description, without auto-applying them',
  commandType: 'ANALYSIS',
  riskLevel: 'LOW_RISK',
  confirmationPolicy: 'NONE',
  requiredPermission: READ_PERMISSION,
  parameterSchema: PROPOSE_DASHBOARD_WIDGETS_SCHEMA,
  inputSchema: (input) => {
    const query = String(input?.query || input?.request || '').trim();
    if (!query) return { valid: false, errors: ['Provide the dashboard request text in "query"'] };
    return { valid: true, value: { query } };
  },
  execute: async (input, context) => {
    const language = context.currentLanguage;
    const proposal = proposeDashboardConfig(input.query, language);
    const widgetSummaries = proposal.sections.flatMap((s) => s.widgets).map((w) => ({
      widgetType: w.widgetType, metric: w.metric, entityType: w.entityType, chartType: w.chartType, analysisMode: w.analysisMode,
    }));
    return {
      success: true,
      data: { sections: proposal.sections, defaultsUsed: proposal.defaultsUsed },
      affectedCount: widgetSummaries.length,
      messageAr: `${proposal.explanationAr} افتح "مصمم التقارير بالذكاء الاصطناعي" داخل لوحة التحكم المخصصة لمعاينة وتطبيق هذا الاقتراح.`,
      messageEn: `${proposal.explanationEn} Open the "AI Report Designer" inside the Custom Dashboard Builder to preview and apply this proposal.`,
    };
  },
};

export function registerDashboardDesignTools(): void {
  registerTool(proposeDashboardWidgets);
}

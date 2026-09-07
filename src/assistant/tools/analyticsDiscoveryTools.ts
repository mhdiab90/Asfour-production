/**
 * Universal Data Intelligence pass - ONE new tool (Part 24/25/46: "prefer 0
 * new tools... if more than 2 required, STOP" - this task needed exactly 1).
 *
 * Lets the AI EXPLAIN what can be derived from current data, reusing the
 * EXACT SAME deterministic discovery engine (analyticsDiscoveryEngine.ts)
 * the "Suggested Analytics" screen renders - the AI never invents a metric
 * definition of its own (Part 24/25: "AI does NOT invent metric
 * definitions... suggestions must be validated against the metric catalog").
 * Read-only (QUERY/ANALYSIS, LOW_RISK, no confirmation) - it can only ever
 * return data, never persist an approval (Part 37 - approval requires the
 * explicit UI action on the Suggested Analytics screen itself).
 */
import { ToolDefinition } from '../types';
import { registerTool } from './registry';
import { PermissionKey } from '../../types/permissions';
import { GET_SUGGESTED_ANALYTICS_SCHEMA } from './parameterSchemas';
import { fetchUniversalStageRecords } from '../../services/stageRecordService';
import { ALL_STAGES } from '../../services/reportingEngine';
import { ProductionStageType } from '../../types';
import {
  discoverMetricSuggestions, discoverDimensionSuggestions, discoverDataQualityFindings,
  discoverAccountingFindings, SuggestionCategory,
} from '../../services/analyticsDiscoveryEngine';

const READ_PERMISSION: PermissionKey[] = ['reports.view', 'production.view'];
const TOP_N = 8;

const getSuggestedAnalytics: ToolDefinition = {
  toolName: 'getSuggestedAnalytics',
  descriptionAr: 'عرض المؤشرات والتحليلات التي يمكن اشتقاقها من البيانات الحالية (اختياريًا حسب فئة/مرحلة)',
  descriptionEn: 'List metrics/analytics derivable from current data (optionally filtered by category/stage)',
  commandType: 'ANALYSIS',
  riskLevel: 'LOW_RISK',
  confirmationPolicy: 'NONE',
  requiredPermission: READ_PERMISSION,
  parameterSchema: GET_SUGGESTED_ANALYTICS_SCHEMA,
  inputSchema: (input) => {
    const category = input?.category ? String(input.category) as SuggestionCategory : undefined;
    const stageType = input?.stageType && ALL_STAGES.includes(input.stageType) ? String(input.stageType) as ProductionStageType : undefined;
    return { valid: true, value: { category, stageType } };
  },
  execute: async (input, context) => {
    const language = context.currentLanguage;
    const isAr = language === 'ar';
    const stage = input.stageType || 'all';

    const end = new Date();
    const start = new Date(end); start.setDate(start.getDate() - 29);
    const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const records = await fetchUniversalStageRecords({ startDate: fmt(start), endDate: fmt(end), stageType: stage === 'all' ? undefined : stage });

    let suggestions = [
      ...discoverMetricSuggestions(records, language, stage),
      ...discoverDimensionSuggestions(records, language, stage),
      ...(stage === 'all' ? discoverAccountingFindings(language) : []),
    ];
    if (input.category) suggestions = suggestions.filter((s) => s.category === input.category);
    suggestions = suggestions
      .filter((s) => s.availability !== 'NOT_AVAILABLE')
      .sort((a, b) => (a.confidence === b.confidence ? 0 : a.confidence === 'HIGH' ? -1 : 1))
      .slice(0, TOP_N);

    const dataQuality = input.category === 'DATA_QUALITY' || !input.category ? discoverDataQualityFindings(records).filter((f) => f.affectedCount > 0) : [];

    if (suggestions.length === 0 && dataQuality.length === 0) {
      return {
        success: true,
        data: { suggestions: [], dataQuality: [] },
        messageAr: 'لا توجد مؤشرات إضافية متاحة للاشتقاق ضمن هذا النطاق حاليًا.',
        messageEn: 'No additional derivable metrics are available for this scope right now.',
      };
    }

    const lineAr = (s: typeof suggestions[number]) => `${s.titleAr}: ${s.previewAr}`;
    const lineEn = (s: typeof suggestions[number]) => `${s.titleEn}: ${s.previewEn}`;
    const dqLineAr = (f: typeof dataQuality[number]) => `${f.titleAr} (${f.affectedCount})`;
    const dqLineEn = (f: typeof dataQuality[number]) => `${f.titleEn} (${f.affectedCount})`;

    const messageAr = [
      suggestions.length ? `مؤشرات يمكن اشتقاقها (آخر 30 يومًا):\n${suggestions.map(lineAr).join('\n')}` : '',
      dataQuality.length ? `ملاحظات جودة بيانات:\n${dataQuality.map(dqLineAr).join('\n')}` : '',
      'للاعتماد أو الإضافة إلى لوحة، افتح شاشة "التحليلات والمؤشرات المقترحة".',
    ].filter(Boolean).join('\n\n');
    const messageEn = [
      suggestions.length ? `Derivable metrics (last 30 days):\n${suggestions.map(lineEn).join('\n')}` : '',
      dataQuality.length ? `Data-quality findings:\n${dataQuality.map(dqLineEn).join('\n')}` : '',
      'To approve or add one to a dashboard, open the "Suggested Analytics" screen.',
    ].filter(Boolean).join('\n\n');

    return {
      success: true,
      data: { suggestions, dataQuality },
      affectedCount: suggestions.length,
      messageAr, messageEn,
    };
  },
};

export function registerAnalyticsDiscoveryTools(): void {
  registerTool(getSuggestedAnalytics);
}

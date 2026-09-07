/**
 * Phase 6 - AI Intelligence: turns the assistant from "answer questions when
 * asked" into "identify useful business insights and explain them" (§6.1),
 * as ONE tool with two modes rather than two separate tools (Part 5 hard
 * tool-count budget - "prefer 0 new tools... acceptable: 1").
 *
 * Reuses the EXACT same primitives every other analytics tool in this
 * codebase already uses (fetchUniversalStageRecords / aggregateByDimension /
 * rankRows / aggregatePeriodTotals) - never a second numbers engine, never
 * an LLM-invented figure (§6.1/§6.2/§7.40).
 *
 * FACT vs ANALYTICAL INDICATION (§6.3/§6.9/§7.55) is a structural property
 * of this file's OWN output, not something left to the model to phrase
 * correctly: every number in `keyMetrics`/`changes`/`strengths`/
 * `weaknesses` is a real, directly-computed FACT; every entry in `risks` is
 * explicitly labeled an analytical indication (a disclosed, conservative
 * period-over-period change threshold - see ANALYTICAL_CHANGE_THRESHOLD_*
 * below), and `recommendations` are generic, pattern-based suggestions tied
 * to the real observed numbers, never presented as official company policy.
 */
import {
  aggregateByDimension,
  rankRows,
  getStageDisplayName,
  ALL_STAGES,
} from '../../services/reportingEngine';
import { fetchUniversalStageRecords } from '../../services/stageRecordService';
import { MultiDimensionFilter, ProductionStageType } from '../../types';
import { ToolDefinition } from '../types';
import { registerTool } from './registry';
import { PermissionKey } from '../../types/permissions';
import { GENERATE_BUSINESS_INSIGHTS_SCHEMA } from './parameterSchemas';
import { resolveDateRange, periodDisclosure } from './dateRangeResolver';
import { aggregatePeriodTotals, METRIC_LABEL_AR, METRIC_LABEL_EN } from './stageReportTools';

const READ_PERMISSION: PermissionKey[] = ['production.view', 'production.create', 'reports.view'];

/**
 * §6.3 - deliberately NOT reusing BUSINESS_VALIDATION_THRESHOLDS
 * (businessValidationRules.ts) here: those (80% waste, 50% downtime ratio)
 * are PER-RECORD data-entry-error thresholds calibrated so a normal 50%
 * waste record still validates cleanly - applying them to a PERIOD-level
 * trend would almost never fire and would misrepresent a data-entry
 * tolerance as a period-health rule. No period-level business threshold
 * exists in this codebase, so this is instead an explicit, conservative,
 * clearly-disclosed ANALYTICAL indication threshold (§6.3: "use transparent
 * conservative analytics and label it as an analytical indication, not a
 * business rule") - shown to the user as exactly that, never as policy.
 */
const ANALYTICAL_CHANGE_THRESHOLD_WARNING = 20;
const ANALYTICAL_CHANGE_THRESHOLD_CRITICAL = 40;

function toLocalDateOnly(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`);
}
function formatDateOnly(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Previous period of EQUAL LENGTH immediately preceding the resolved one - the ONE deterministic comparison baseline every mode here uses, never left to the model to guess (§6.13/§7.32 - canonical date logic only). */
function previousPeriodOf(startDate: string, endDate: string): { startDate: string; endDate: string } {
  const start = toLocalDateOnly(startDate);
  const end = toLocalDateOnly(endDate);
  const spanDays = Math.round((end.getTime() - start.getTime()) / 86400000) + 1;
  const prevEnd = new Date(start.getTime() - 86400000);
  const prevStart = new Date(prevEnd.getTime() - (spanDays - 1) * 86400000);
  return { startDate: formatDateOnly(prevStart), endDate: formatDateOnly(prevEnd) };
}

function pctChange(previous: number, current: number): number | null {
  if (previous !== 0) return ((current - previous) / previous) * 100;
  return current !== 0 ? null : 0;
}

interface ChangeEntry {
  metric: 'productionTons' | 'wasteTons' | 'downtimeMinutes';
  currentValue: number;
  previousValue: number;
  percentageChange: number | null;
}

function computeChanges(current: { productionTons: number; wasteTons: number; downtimeMinutes: number }, previous: typeof current): ChangeEntry[] {
  return (['productionTons', 'wasteTons', 'downtimeMinutes'] as const).map((metric) => ({
    metric,
    currentValue: Number(current[metric].toFixed(2)),
    previousValue: Number(previous[metric].toFixed(2)),
    percentageChange: pctChange(previous[metric], current[metric]) !== null ? Number((pctChange(previous[metric], current[metric]) as number).toFixed(1)) : null,
  }));
}

/** §6.5/§6.6 - a "worse" direction differs per metric: waste/downtime rising is bad; production falling is bad. */
const METRIC_BAD_DIRECTION: Record<ChangeEntry['metric'], 'up' | 'down'> = {
  productionTons: 'down',
  wasteTons: 'up',
  downtimeMinutes: 'up',
};
const METRIC_ALERT_CATEGORY: Record<ChangeEntry['metric'], string> = {
  productionTons: 'PRODUCTION_DROP',
  wasteTons: 'HIGH_WASTE',
  downtimeMinutes: 'HIGH_DOWNTIME',
};

interface AlertEntry {
  category: string;
  severity: 'WARNING' | 'CRITICAL';
  metric: ChangeEntry['metric'];
  percentageChange: number;
  currentValue: number;
  previousValue: number;
}

function computeAlerts(changes: ChangeEntry[]): AlertEntry[] {
  const alerts: AlertEntry[] = [];
  for (const c of changes) {
    if (c.percentageChange === null) continue;
    const badDirection = METRIC_BAD_DIRECTION[c.metric];
    const isBadDirection = badDirection === 'up' ? c.percentageChange > 0 : c.percentageChange < 0;
    if (!isBadDirection) continue;
    const magnitude = Math.abs(c.percentageChange);
    if (magnitude >= ANALYTICAL_CHANGE_THRESHOLD_CRITICAL) {
      alerts.push({ category: METRIC_ALERT_CATEGORY[c.metric], severity: 'CRITICAL', metric: c.metric, percentageChange: c.percentageChange, currentValue: c.currentValue, previousValue: c.previousValue });
    } else if (magnitude >= ANALYTICAL_CHANGE_THRESHOLD_WARNING) {
      alerts.push({ category: METRIC_ALERT_CATEGORY[c.metric], severity: 'WARNING', metric: c.metric, percentageChange: c.percentageChange, currentValue: c.currentValue, previousValue: c.previousValue });
    }
  }
  return alerts;
}

const generateBusinessInsights: ToolDefinition = {
  toolName: 'generateBusinessInsights',
  descriptionAr: 'إنشاء ملخص تنفيذي للإدارة أو تنبيهات تحليلية مبنية على بيانات الإنتاج الفعلية (وضعان: summary أو alerts)',
  descriptionEn: 'Generate a management executive summary or data-driven analytical alerts (modes: summary or alerts)',
  commandType: 'ANALYSIS',
  riskLevel: 'LOW_RISK',
  confirmationPolicy: 'NONE',
  requiredPermission: READ_PERMISSION,
  parameterSchema: GENERATE_BUSINESS_INSIGHTS_SCHEMA,
  inputSchema: (input) => {
    const mode = input?.mode === 'alerts' ? 'alerts' : (input?.mode === 'summary' ? 'summary' : undefined);
    if (!mode) return { valid: false, errors: ['mode must be "summary" or "alerts"'] };
    const stageType = input?.stageType && ALL_STAGES.includes(input.stageType) ? String(input.stageType) as ProductionStageType : undefined;
    return { valid: true, value: { mode, startDate: input?.startDate, endDate: input?.endDate, stageType } };
  },
  execute: async (input, context) => {
    const language = context.currentLanguage;
    const isAr = language === 'ar';
    const { startDate, endDate, wasDefaulted } = resolveDateRange(input);
    const prev = previousPeriodOf(startDate, endDate);

    const [current, previous] = await Promise.all([
      aggregatePeriodTotals(startDate, endDate, input.stageType, language),
      aggregatePeriodTotals(prev.startDate, prev.endDate, input.stageType, language),
    ]);
    const changes = computeChanges(current, previous);
    const scopeLabelAr = input.stageType ? getStageDisplayName(input.stageType, 'ar') : 'المصنع بالكامل (كل المراحل)';
    const scopeLabelEn = input.stageType ? getStageDisplayName(input.stageType, 'en') : 'Factory-wide (all stages)';
    const periodNote = periodDisclosure({ startDate, endDate, wasDefaulted }, language);
    const metricLabel = (m: ChangeEntry['metric']) => (isAr ? METRIC_LABEL_AR[m] : METRIC_LABEL_EN[m]);
    const changeLine = (c: ChangeEntry) => {
      const pctText = c.percentageChange === null ? (isAr ? 'غير محدد' : 'N/A') : `${c.percentageChange >= 0 ? '+' : ''}${c.percentageChange}%`;
      return isAr
        ? `${metricLabel(c.metric)}: ${c.currentValue} (كان ${c.previousValue}، ${pctText})`
        : `${metricLabel(c.metric)}: ${c.currentValue} (was ${c.previousValue}, ${pctText})`;
    };

    if (input.mode === 'alerts') {
      const alerts = computeAlerts(changes);
      if (alerts.length === 0) {
        return {
          success: true,
          data: { period: { startDate, endDate }, previousPeriod: prev, scope: input.stageType || 'all', alerts: [] },
          messageAr: `لا توجد مؤشرات تستدعي الانتباه ${scopeLabelAr} خلال هذه الفترة${periodNote} (مقارنة بالفترة السابقة المكافئة ${prev.startDate} → ${prev.endDate}).`,
          messageEn: `No indications warrant attention for ${scopeLabelEn} in this period${periodNote} (vs. the equal-length prior period ${prev.startDate} to ${prev.endDate}).`,
        };
      }
      const lines = alerts.map((a) => {
        const sevAr = a.severity === 'CRITICAL' ? 'حرج' : 'تنبيه';
        const sevEn = a.severity;
        const why = isAr
          ? `${METRIC_LABEL_AR[a.metric]} تغيّر بنسبة ${a.percentageChange >= 0 ? '+' : ''}${a.percentageChange}% مقارنة بالفترة السابقة المكافئة - مؤشر تحليلي مبدئي، وليس قاعدة عمل رسمية.`
          : `${METRIC_LABEL_EN[a.metric]} changed by ${a.percentageChange >= 0 ? '+' : ''}${a.percentageChange}% vs. the equal-length prior period - a preliminary analytical indication, not an official business rule.`;
        return isAr
          ? `[${sevAr}] ${a.category} - ${why} (الحالي: ${a.currentValue}, السابق: ${a.previousValue})`
          : `[${sevEn}] ${a.category} - ${why} (current: ${a.currentValue}, previous: ${a.previousValue})`;
      });
      return {
        success: true,
        data: { period: { startDate, endDate }, previousPeriod: prev, scope: input.stageType || 'all', alerts },
        affectedCount: alerts.length,
        messageAr: `تنبيهات ${scopeLabelAr}${periodNote}:\n${lines.join('\n')}`,
        messageEn: `Alerts for ${scopeLabelEn}${periodNote}:\n${lines.join('\n')}`,
      };
    }

    // mode === 'summary'
    const filters: MultiDimensionFilter = { startDate, endDate };
    if (input.stageType) filters.stageType = input.stageType;
    const records = await fetchUniversalStageRecords(filters);
    const topEmployees = rankRows(aggregateByDimension(records, 'employee', language), 'productionTons', 'best', 3);
    const worstEquipment = rankRows(aggregateByDimension(records, 'equipment', language), 'wasteTons', 'worst', 1);
    const alerts = computeAlerts(changes);

    const strengthsAr = topEmployees.length ? topEmployees.map((r) => `${r.label} (${r.productionTons.toFixed(2)} طن)`).join('، ') : 'لا توجد بيانات كافية';
    const strengthsEn = topEmployees.length ? topEmployees.map((r) => `${r.label} (${r.productionTons.toFixed(2)} t)`).join(', ') : 'Not enough data';
    const weaknessAr = worstEquipment.length ? `${worstEquipment[0].label} (${worstEquipment[0].wasteTons.toFixed(2)} طن هالك)` : 'لا توجد بيانات كافية';
    const weaknessEn = worstEquipment.length ? `${worstEquipment[0].label} (${worstEquipment[0].wasteTons.toFixed(2)} t waste)` : 'Not enough data';

    const recommendationsAr: string[] = [];
    const recommendationsEn: string[] = [];
    if (worstEquipment.length && worstEquipment[0].wasteTons > 0) {
      recommendationsAr.push(`مراجعة أداء "${worstEquipment[0].label}" - سجّلت أعلى نسبة هالك (${worstEquipment[0].wastePercentage}%) خلال الفترة.`);
      recommendationsEn.push(`Review "${worstEquipment[0].label}" - it recorded the highest waste rate (${worstEquipment[0].wastePercentage}%) this period.`);
    }
    for (const a of alerts) {
      recommendationsAr.push(`متابعة ${METRIC_LABEL_AR[a.metric]} (${a.category}) - تغيّر ${a.percentageChange >= 0 ? '+' : ''}${a.percentageChange}% عن الفترة السابقة.`);
      recommendationsEn.push(`Monitor ${METRIC_LABEL_EN[a.metric]} (${a.category}) - changed ${a.percentageChange >= 0 ? '+' : ''}${a.percentageChange}% vs. the prior period.`);
    }
    if (recommendationsAr.length === 0) {
      recommendationsAr.push('لا توجد توصيات عاجلة - المؤشرات ضمن النطاق المعتاد مقارنة بالفترة السابقة.');
      recommendationsEn.push('No urgent recommendations - indicators are within the usual range vs. the prior period.');
    }

    const messageAr = [
      `ملخص تنفيذي - ${scopeLabelAr}${periodNote} (مقارنة بـ ${prev.startDate} → ${prev.endDate}):`,
      `المؤشرات الرئيسية: إجمالي الإنتاج ${current.productionTons.toFixed(2)} طن، الإنتاج السليم ${current.goodTons.toFixed(2)} طن، الهالك ${current.wasteTons.toFixed(2)} طن (${current.wastePercentage.toFixed(1)}%)، التوقف ${current.downtimeMinutes.toFixed(0)} دقيقة، عدد السجلات ${current.recordCount}.`,
      `التغيرات: ${changes.map(changeLine).join('، ')}.`,
      `نقاط القوة: ${strengthsAr}.`,
      `نقاط الضعف: ${weaknessAr}.`,
      alerts.length ? `مخاطر (مؤشرات تحليلية، وليست حقائق مؤكدة السبب): ${alerts.map((a) => `${a.category} (${a.severity})`).join('، ')}.` : 'لا توجد مخاطر تحليلية ملحوظة.',
      `التوصيات: ${recommendationsAr.join(' ')}`,
    ].join('\n');

    const messageEn = [
      `Executive summary - ${scopeLabelEn}${periodNote} (vs. ${prev.startDate} to ${prev.endDate}):`,
      `Key metrics: total production ${current.productionTons.toFixed(2)} t, good production ${current.goodTons.toFixed(2)} t, waste ${current.wasteTons.toFixed(2)} t (${current.wastePercentage.toFixed(1)}%), downtime ${current.downtimeMinutes.toFixed(0)} min, records ${current.recordCount}.`,
      `Changes: ${changes.map(changeLine).join(', ')}.`,
      `Strengths: ${strengthsEn}.`,
      `Weaknesses: ${weaknessEn}.`,
      alerts.length ? `Risks (analytical indications, not confirmed-cause facts): ${alerts.map((a) => `${a.category} (${a.severity})`).join(', ')}.` : 'No notable analytical risks.',
      `Recommendations: ${recommendationsEn.join(' ')}`,
    ].join('\n');

    return {
      success: true,
      data: {
        period: { startDate, endDate, wasDefaulted },
        previousPeriod: prev,
        scope: input.stageType || 'all',
        keyMetrics: current,
        changes,
        strengths: topEmployees.map((r) => ({ label: r.label, productionTons: r.productionTons })),
        weaknesses: worstEquipment.map((r) => ({ label: r.label, wasteTons: r.wasteTons, wastePercentage: r.wastePercentage })),
        risks: alerts,
      },
      affectedCount: current.recordCount,
      messageAr,
      messageEn,
    };
  },
};

export function registerBusinessInsightsTools(): void {
  registerTool(generateBusinessInsights);
}

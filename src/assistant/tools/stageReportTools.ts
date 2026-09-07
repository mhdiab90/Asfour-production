/**
 * Stage-aware reporting/ranking tools (§29/§30/§33/§36/§41/§42/§43/§44).
 *
 * These tools are the AI's ONLY way to see data outside the single 'pressing'
 * collection - fetchProductionRecords() (used by productionQueryTools.ts)
 * only reads the pressing-specific `production` collection, so any question
 * about rotary_furnace/chinese_mills/etc. would silently return empty
 * results without this file. They reuse fetchUniversalStageRecords() and
 * reportingEngine.ts's aggregateByDimension()/rankRows() - the EXACT same
 * functions the Reports UI uses - so the assistant's numbers can never
 * diverge from what a human sees in Reports (§31/§33: no second reporting
 * engine, no fabricated numbers).
 */
import { fetchUniversalStageRecords } from '../../services/stageRecordService';
import {
  aggregateByDimension,
  rankRows,
  filterUniversalRecords,
  getStageDisplayName,
  ALL_STAGES,
  REPORT_CATEGORIES,
  RankingMetric,
  ReportDimension,
} from '../../services/reportingEngine';
import { MultiDimensionFilter, ProductionStageType } from '../../types';
import { ToolDefinition } from '../types';
import { registerTool } from './registry';
import { PermissionKey } from '../../types/permissions';
import { RANKING_SCHEMA, PRODUCTION_BY_STAGE_SCHEMA, COMPARE_STAGES_SCHEMA, COMPARE_PERIODS_SCHEMA, GENERATE_REPORT_SCHEMA } from './parameterSchemas';
import { resolveDateRange, periodDisclosure } from './dateRangeResolver';

const READ_PERMISSION: PermissionKey[] = ['production.view', 'production.create', 'reports.view'];

const RANKING_METRICS: RankingMetric[] = ['productionTons', 'goodTons', 'wasteTons', 'wastePercentage', 'downtimeMinutes', 'operationsCount'];

function resolveMetric(input: any): { metric: RankingMetric; wasDefaulted: boolean } {
  const requested = String(input?.metric || '').trim();
  if (RANKING_METRICS.includes(requested as RankingMetric)) return { metric: requested as RankingMetric, wasDefaulted: false };
  // §41 - default ranking metric when the user doesn't specify one, ALWAYS disclosed in the message.
  return { metric: 'goodTons', wasDefaulted: true };
}

function baseTool(
  toolName: string,
  descriptionAr: string,
  descriptionEn: string
): Pick<ToolDefinition, 'toolName' | 'descriptionAr' | 'descriptionEn' | 'commandType' | 'riskLevel' | 'confirmationPolicy' | 'requiredPermission'> {
  return { toolName, descriptionAr, descriptionEn, commandType: 'ANALYSIS', riskLevel: 'LOW_RISK', confirmationPolicy: 'NONE', requiredPermission: READ_PERMISSION };
}

/** Exported for businessInsightsTools.ts (Phase 6) - the SAME metric vocabulary, never a second label set. */
export const METRIC_LABEL_AR: Record<RankingMetric, string> = {
  productionTons: 'إجمالي الإنتاج', goodTons: 'الإنتاج السليم', wasteTons: 'الهالك', wastePercentage: 'نسبة الهالك', downtimeMinutes: 'التوقف', operationsCount: 'عدد التشغيلات',
};
export const METRIC_LABEL_EN: Record<RankingMetric, string> = {
  productionTons: 'total production', goodTons: 'good production', wasteTons: 'waste', wastePercentage: 'waste rate', downtimeMinutes: 'downtime', operationsCount: 'operation count',
};

/** Plural dimension labels for the ranking message header ("أفضل 5 موظفين" / "Top 5 employees") - Rule 9. */
const DIMENSION_LABEL_AR: Record<ReportDimension, string> = {
  employee: 'موظفين', shift: 'ورديات', equipment: 'معدات', product: 'منتجات', customer: 'عملاء', stage: 'مراحل',
};
const DIMENSION_LABEL_EN: Record<ReportDimension, string> = {
  employee: 'employees', shift: 'shifts', equipment: 'equipment', product: 'products', customer: 'customers', stage: 'stages',
};

/** §18 - "top N" must be validated, not trusted blindly: a positive integer, floored, and capped so a degenerate N never balloons the payload sent to the model (§30/§31 data minimization). */
function resolveLimit(input: any): number {
  const raw = Number(input?.limit);
  if (!Number.isFinite(raw) || raw <= 0) return 5;
  return Math.min(Math.floor(raw), 50);
}

/** §19 - standard competition ranking (1,2,2,4): equal values at adjacent positions share a rank number instead of an arbitrary tie-break, so a tie is a structural fact of the result, not something the caller has to notice by comparing values itself. */
function annotateRanks<T extends { value: number }>(rows: T[]): Array<T & { rank: number }> {
  let currentRank = 0;
  let previousValue: number | null = null;
  return rows.map((r, idx) => {
    if (previousValue === null || r.value !== previousValue) currentRank = idx + 1;
    previousValue = r.value;
    return { ...r, rank: currentRank };
  });
}

async function rankDimension(dimension: ReportDimension, input: any, language: 'ar' | 'en') {
  const { startDate, endDate, wasDefaulted: periodDefaulted } = resolveDateRange(input);
  const { metric, wasDefaulted: metricDefaulted } = resolveMetric(input);
  const direction: 'best' | 'worst' = input?.direction === 'worst' ? 'worst' : 'best';
  const limit = resolveLimit(input);

  const filters: MultiDimensionFilter = { startDate, endDate };
  if (input?.stageType && ALL_STAGES.includes(input.stageType)) filters.stageType = input.stageType;

  const records = await fetchUniversalStageRecords(filters);
  const rows = aggregateByDimension(records, dimension, language);
  const rankedRaw = rankRows(rows, metric, direction, limit).map((r) => ({
    label: r.label, productionTons: Number(r.productionTons.toFixed(2)), goodTons: Number(r.goodTons.toFixed(2)),
    wasteTons: Number(r.wasteTons.toFixed(2)), wastePercentage: r.wastePercentage, downtimeMinutes: Number(r.downtimeMinutes.toFixed(1)), operationsCount: r.operationsCount,
    value: 0 as number,
  }));
  for (const r of rankedRaw) r.value = (r as any)[metric];
  const ranked = annotateRanks(rankedRaw).map(({ value, ...rest }) => rest);

  const metricLabel = language === 'ar' ? METRIC_LABEL_AR[metric] : METRIC_LABEL_EN[metric];
  // §12/§13 - never the vague "الفترة الافتراضية" alone; periodDisclosure()
  // (dateRangeResolver.ts) always includes the actual resolved dates, even
  // when defaulted - the SAME function every other tool already uses.
  const resolvedRange = { startDate, endDate, wasDefaulted: periodDefaulted };
  const periodNoteAr = periodDisclosure(resolvedRange, 'ar');
  const periodNoteEn = periodDisclosure(resolvedRange, 'en');
  const metricNoteAr = metricDefaulted ? ` تم التقييم بناءً على ${metricLabel} (المقياس الافتراضي).` : ` بناءً على ${metricLabel}.`;
  const metricNoteEn = metricDefaulted ? ` Ranked by ${metricLabel} (default metric).` : ` Ranked by ${metricLabel}.`;

  // Critical Analytics/Workflow Correction, Rule 8/9 - the deterministic
  // message must enumerate EVERY returned row (1..N), never only the #1
  // entry. Live evidence showed "أفضل 5 موظفين" collapsing to a single
  // "الأفضل: X" sentence, after which the model's own free-text inference
  // (analyzeToolResult) improvised commentary about "العامل الثاني" that was
  // never actually shown anywhere - runToolAndRespond() always falls back to
  // THIS text as the authoritative factual summary, so a complete list here
  // is what makes the final reply complete regardless of provider/model
  // quality (Rule 14/16/17). r.rank (annotateRanks(), competition-style
  // 1,2,2,4) is reused as the displayed number, not a naive 1..N recount -
  // preserves the existing "never silently pick one winner among ties" rule
  // this file already established, it just doesn't collapse to a
  // single-line summary anymore.
  const directionNoteAr = direction === 'worst' ? ' (الأقل أداءً)' : '';
  const directionNoteEn = direction === 'worst' ? ' (worst-performing)' : '';
  const dimensionLabelAr = DIMENSION_LABEL_AR[dimension];
  const dimensionLabelEn = DIMENSION_LABEL_EN[dimension];

  let messageAr: string;
  let messageEn: string;
  if (ranked.length === 0) {
    messageAr = `لا توجد بيانات مطابقة للفلاتر المحددة.${periodNoteAr}`;
    messageEn = `No matching data for the specified filters.${periodNoteEn}`;
  } else {
    const headerAr = `أفضل ${ranked.length} ${dimensionLabelAr}${directionNoteAr}${metricNoteAr}${periodNoteAr}:`;
    const headerEn = `Top ${ranked.length} ${dimensionLabelEn}${directionNoteEn}${metricNoteEn}${periodNoteEn}:`;
    const linesAr = ranked.map((r) => `${r.rank}. ${r.label} — ${(r as any)[metric]}`).join('\n');
    const linesEn = ranked.map((r) => `${r.rank}. ${r.label} — ${(r as any)[metric]}`).join('\n');
    messageAr = `${headerAr}\n${linesAr}`;
    messageEn = `${headerEn}\n${linesEn}`;
  }

  return { success: true, data: { dimension, metric, direction, period: { startDate, endDate, wasDefaulted: periodDefaulted }, results: ranked }, affectedCount: ranked.length, messageAr, messageEn };
}

const getTopEmployees: ToolDefinition = {
  ...baseTool('getTopEmployees', 'أفضل/أسوأ الموظفين حسب مقياس محدد وفترة زمنية', 'Best/worst employees by a chosen metric and time range'),
  parameterSchema: RANKING_SCHEMA,
  inputSchema: (input) => ({ valid: true, value: input || {} }),
  execute: async (input, context) => rankDimension('employee', input, context.currentLanguage),
};

const getTopShifts: ToolDefinition = {
  ...baseTool('getTopShifts', 'أفضل/أسوأ الورديات (1، 2، 3) حسب مقياس محدد', 'Best/worst shifts (1, 2, 3) by a chosen metric'),
  parameterSchema: RANKING_SCHEMA,
  inputSchema: (input) => ({ valid: true, value: input || {} }),
  execute: async (input, context) => rankDimension('shift', input, context.currentLanguage),
};

const getTopPresses: ToolDefinition = {
  ...baseTool('getTopPresses', 'أفضل/أسوأ المعدات (مكابس/أفران/آلات) حسب مقياس محدد', 'Best/worst equipment (presses/furnaces/machines) by a chosen metric'),
  parameterSchema: RANKING_SCHEMA,
  inputSchema: (input) => ({ valid: true, value: input || {} }),
  execute: async (input, context) => rankDimension('equipment', input, context.currentLanguage),
};

const getTopProducts: ToolDefinition = {
  ...baseTool('getTopProducts', 'أفضل/أسوأ المنتجات حسب مقياس محدد', 'Best/worst products by a chosen metric'),
  parameterSchema: RANKING_SCHEMA,
  inputSchema: (input) => ({ valid: true, value: input || {} }),
  execute: async (input, context) => rankDimension('product', input, context.currentLanguage),
};

/** §15 - customer analysis: aggregateByDimension() ALREADY supports a 'customer' dimension (reportingEngine.ts) - this is a thin wrapper only, no new aggregation logic, exactly the same pattern as getTopEmployees/getTopPresses/getTopProducts. */
const getTopCustomers: ToolDefinition = {
  ...baseTool('getTopCustomers', 'أكبر/أصغر العملاء إنتاجاً حسب مقياس محدد', 'Biggest/smallest customers by production, by a chosen metric'),
  parameterSchema: RANKING_SCHEMA,
  inputSchema: (input) => ({ valid: true, value: input || {} }),
  execute: async (input, context) => rankDimension('customer', input, context.currentLanguage),
};

const getProductionByStage: ToolDefinition = {
  ...baseTool('getProductionByStage', 'الإنتاج مجمعاً حسب المرحلة الإنتاجية (كل المراحل الثمانية)', 'Production grouped by manufacturing stage (all 8 stages)'),
  parameterSchema: PRODUCTION_BY_STAGE_SCHEMA,
  inputSchema: (input) => ({ valid: true, value: input || {} }),
  execute: async (input, context) => {
    const { startDate, endDate, wasDefaulted } = resolveDateRange(input);
    const records = await fetchUniversalStageRecords({ startDate, endDate });
    const rows = aggregateByDimension(records, 'stage', context.currentLanguage);
    // §12/§13 - always disclose the actual resolved dates, never a vague default label.
    const periodNote = periodDisclosure({ startDate, endDate, wasDefaulted }, context.currentLanguage);
    return {
      success: true,
      data: { period: { startDate, endDate, wasDefaulted }, results: rows.map((r) => ({ stage: r.key, label: r.label, productionTons: Number(r.productionTons.toFixed(2)), wasteTons: Number(r.wasteTons.toFixed(2)), downtimeMinutes: Number(r.downtimeMinutes.toFixed(1)), operationsCount: r.operationsCount })) },
      affectedCount: rows.length,
      messageAr: `توزيع الإنتاج على ${rows.length} مرحلة${periodNote}.`,
      messageEn: `Production spread across ${rows.length} stage(s)${periodNote}.`,
    };
  },
};

const compareStages: ToolDefinition = {
  ...baseTool('compareStages', 'مقارنة مرحلتين إنتاجيتين أو أكثر (إنتاج/هالك/توقف)', 'Compare two or more production stages (production/waste/downtime)'),
  parameterSchema: COMPARE_STAGES_SCHEMA,
  inputSchema: (input) => {
    const stages = Array.isArray(input?.stages) ? input.stages.filter((s: string) => ALL_STAGES.includes(s as ProductionStageType)) : [];
    if (stages.length < 2) return { valid: false, errors: ['Provide at least 2 valid stage identifiers in "stages"'] };
    return { valid: true, value: { ...input, stages } };
  },
  execute: async (input, context) => {
    const { startDate, endDate, wasDefaulted } = resolveDateRange(input);
    const records = await fetchUniversalStageRecords({ startDate, endDate });
    const rows = aggregateByDimension(records, 'stage', context.currentLanguage).filter((r) => input.stages.includes(r.key));
    const language = context.currentLanguage;
    const summary = rows.map((r) => `${r.label}: ${language === 'ar' ? 'إنتاج' : 'production'} ${r.productionTons.toFixed(2)}, ${language === 'ar' ? 'هالك' : 'waste'} ${r.wasteTons.toFixed(2)}, ${language === 'ar' ? 'توقف' : 'downtime'} ${r.downtimeMinutes.toFixed(0)}`).join(' | ');
    // §12/§13 - always disclose the actual resolved dates, never a vague default label.
    const periodNote = periodDisclosure({ startDate, endDate, wasDefaulted }, language);
    return {
      success: true,
      data: { period: { startDate, endDate, wasDefaulted }, stages: rows },
      affectedCount: rows.length,
      messageAr: `${summary}${periodNote}`,
      messageEn: `${summary}${periodNote}`,
    };
  },
};

/**
 * §20/§21/§24/§34 - period-vs-period comparison ("قارن مايو ويونيو"). Reuses
 * aggregateByDimension('stage', ...) - the SAME function every other
 * ranking/report tool here uses - to total each period, rather than writing
 * a second reduce/aggregation. Summing already-computed per-stage rows (and
 * re-deriving wastePercentage with the identical ratio aggregateByDimension
 * itself uses per row) is not a new business formula, just the same one
 * applied once more at the whole-period grain.
 */
/** Exported for businessInsightsTools.ts (Phase 6) - reused verbatim rather than re-implemented, so the executive-summary/alert tool's period totals can never diverge from comparePeriods' own numbers. */
export async function aggregatePeriodTotals(startDate: string, endDate: string, stageType: string | undefined, language: 'ar' | 'en') {
  const filters: MultiDimensionFilter = { startDate, endDate };
  if (stageType && ALL_STAGES.includes(stageType as ProductionStageType)) filters.stageType = stageType as ProductionStageType;
  const records = await fetchUniversalStageRecords(filters);
  const rows = aggregateByDimension(records, 'stage', language);
  const productionTons = rows.reduce((s, r) => s + r.productionTons, 0);
  const goodTons = rows.reduce((s, r) => s + r.goodTons, 0);
  const wasteTons = rows.reduce((s, r) => s + r.wasteTons, 0);
  const downtimeMinutes = rows.reduce((s, r) => s + r.downtimeMinutes, 0);
  const wastePercentage = productionTons > 0 ? (wasteTons / productionTons) * 100 : 0;
  return { productionTons, goodTons, wasteTons, downtimeMinutes, wastePercentage, recordCount: records.length };
}

const METRIC_UNIT: Record<RankingMetric, string> = {
  productionTons: 'tons', goodTons: 'tons', wasteTons: 'tons', wastePercentage: 'percent', downtimeMinutes: 'minutes', operationsCount: 'count',
};

const comparePeriods: ToolDefinition = {
  ...baseTool('comparePeriods', 'مقارنة فترتين زمنيتين محددتين صراحة (مثال: مايو مقابل يونيو)', 'Compare two explicit date periods (e.g. May vs June)'),
  parameterSchema: COMPARE_PERIODS_SCHEMA,
  inputSchema: (input) => {
    const a = input?.periodA;
    const b = input?.periodB;
    if (!a?.startDate || !a?.endDate || !b?.startDate || !b?.endDate) {
      return { valid: false, errors: ['periodA and periodB each require explicit startDate and endDate - never leave one defaulted when comparing two periods'] };
    }
    const metric: RankingMetric = ['productionTons', 'goodTons', 'wasteTons', 'wastePercentage', 'downtimeMinutes'].includes(input?.metric) ? input.metric : 'productionTons';
    const stageType = input?.stageType && ALL_STAGES.includes(input.stageType) ? String(input.stageType) : undefined;
    return {
      valid: true,
      value: {
        periodA: { startDate: String(a.startDate), endDate: String(a.endDate), label: a.label ? String(a.label) : `${a.startDate} → ${a.endDate}` },
        periodB: { startDate: String(b.startDate), endDate: String(b.endDate), label: b.label ? String(b.label) : `${b.startDate} → ${b.endDate}` },
        stageType,
        metric,
      },
    };
  },
  execute: async (input, context) => {
    const language = context.currentLanguage;
    const [aggA, aggB] = await Promise.all([
      aggregatePeriodTotals(input.periodA.startDate, input.periodA.endDate, input.stageType, language),
      aggregatePeriodTotals(input.periodB.startDate, input.periodB.endDate, input.stageType, language),
    ]);
    const metric: RankingMetric = input.metric;
    const leftValue = (aggA as any)[metric] as number;
    const rightValue = (aggB as any)[metric] as number;
    const difference = rightValue - leftValue;
    // §24 - computed from PRECISE unrounded totals, only rounded for display below; and never fabricated as a fake percentage when the baseline is zero (§26/§27 - "N/A", not an invented number).
    const percentageChange = leftValue !== 0 ? (difference / leftValue) * 100 : (rightValue !== 0 ? null : 0);
    const scopeLabelAr = input.stageType ? getStageDisplayName(input.stageType, 'ar') : 'المصنع بالكامل (كل المراحل)';
    const scopeLabelEn = input.stageType ? getStageDisplayName(input.stageType, 'en') : 'Factory-wide (all stages)';
    const metricLabel = language === 'ar' ? METRIC_LABEL_AR[metric] : METRIC_LABEL_EN[metric];
    const unit = METRIC_UNIT[metric];
    const pctTextAr = percentageChange === null ? 'غير محدد (الفترة الأولى صفر)' : `${percentageChange >= 0 ? '+' : ''}${percentageChange.toFixed(1)}%`;
    const pctTextEn = percentageChange === null ? 'N/A (baseline period was zero)' : `${percentageChange >= 0 ? '+' : ''}${percentageChange.toFixed(1)}%`;

    return {
      success: true,
      data: {
        leftScope: { period: input.periodA, stage: input.stageType || 'all' },
        rightScope: { period: input.periodB, stage: input.stageType || 'all' },
        leftValue: Number(leftValue.toFixed(2)),
        rightValue: Number(rightValue.toFixed(2)),
        difference: Number(difference.toFixed(2)),
        percentageChange: percentageChange === null ? null : Number(percentageChange.toFixed(2)),
        metric,
        unit,
        scope: input.stageType || 'all',
        recordCountA: aggA.recordCount,
        recordCountB: aggB.recordCount,
      },
      affectedCount: aggA.recordCount + aggB.recordCount,
      messageAr: `${scopeLabelAr} - ${metricLabel}: ${input.periodA.label} = ${leftValue.toFixed(2)}، ${input.periodB.label} = ${rightValue.toFixed(2)} (${unit === 'tons' ? 'طن' : unit === 'percent' ? '%' : unit === 'minutes' ? 'دقيقة' : ''}). الفرق: ${difference >= 0 ? '+' : ''}${difference.toFixed(2)} (${pctTextAr}). عدد السجلات: ${aggA.recordCount} مقابل ${aggB.recordCount}.`,
      messageEn: `${scopeLabelEn} - ${metricLabel}: ${input.periodA.label} = ${leftValue.toFixed(2)} ${unit}, ${input.periodB.label} = ${rightValue.toFixed(2)} ${unit}. Difference: ${difference >= 0 ? '+' : ''}${difference.toFixed(2)} (${pctTextEn}). Record count: ${aggA.recordCount} vs ${aggB.recordCount}.`,
    };
  },
};

/** §33 - the assistant's "generate a report" capability, reusing the SAME REPORT_CATEGORIES/aggregateByDimension the Reports UI uses - never a parallel reporting engine. */
const generateReport: ToolDefinition = {
  ...baseTool('generateReport', 'توليد تقرير من كتالوج التقارير الموجود (نفس محرك شاشة التقارير)', 'Generate a report from the existing report catalog (same engine as the Reports screen)'),
  parameterSchema: GENERATE_REPORT_SCHEMA,
  inputSchema: (input) => {
    const categoryId = String(input?.categoryId || input?.reportType || 'production');
    const category = REPORT_CATEGORIES.find((c) => c.id === categoryId);
    if (!category) return { valid: false, errors: [`Unknown report category "${categoryId}". Valid: ${REPORT_CATEGORIES.map((c) => c.id).join(', ')}`] };
    return { valid: true, value: { ...input, categoryId } };
  },
  execute: async (input, context) => {
    const category = REPORT_CATEGORIES.find((c) => c.id === input.categoryId)!;
    const { startDate, endDate, wasDefaulted } = resolveDateRange(input);
    const filters: MultiDimensionFilter = { startDate, endDate };
    if (input?.stageType && ALL_STAGES.includes(input.stageType)) filters.stageType = input.stageType;
    const records = await fetchUniversalStageRecords(filters);
    const filtered = filterUniversalRecords(records, filters);
    const rows = aggregateByDimension(filtered, category.dimension, context.currentLanguage).map((r) => ({
      label: r.label, productionTons: Number(r.productionTons.toFixed(2)), goodTons: Number(r.goodTons.toFixed(2)), wasteTons: Number(r.wasteTons.toFixed(2)), wastePercentage: r.wastePercentage, downtimeMinutes: Number(r.downtimeMinutes.toFixed(1)), operationsCount: r.operationsCount,
    }));
    const language = context.currentLanguage;
    const name = language === 'ar' ? category.nameAr : category.nameEn;
    // §12/§13 - always disclose the actual resolved dates, never a vague default label.
    const periodNote = periodDisclosure({ startDate, endDate, wasDefaulted }, language);
    return {
      success: true,
      data: { category: category.id, period: { startDate, endDate, wasDefaulted }, rows },
      affectedCount: rows.length,
      messageAr: `تم إنشاء تقرير "${name}" (${rows.length} صف)${periodNote}. استخدم أداة exportReportToExcel لتصديره.`,
      messageEn: `Generated "${name}" report (${rows.length} rows)${periodNote}. Use exportReportToExcel to export it.`,
    };
  },
};

export function registerStageReportTools(): void {
  [getTopEmployees, getTopShifts, getTopPresses, getTopProducts, getTopCustomers, getProductionByStage, compareStages, comparePeriods, generateReport].forEach(registerTool);
}

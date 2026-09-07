/**
 * Universal Analytics Discovery Engine (Universal Data Intelligence pass).
 *
 * A METADATA-DRIVEN suggestion generator - it never invents a metric or a
 * formula of its own. It systematically cross-references registries this
 * codebase already has:
 *   - METRIC_REGISTRY (dashboardRegistry.ts) - what can be computed, and how
 *   - PRODUCTION_STAGE_REGISTRY (productionStageRegistry.ts) - which metrics
 *     are meaningful for which stage
 *   - ENTITY_TO_DIMENSION / aggregateByDimension / rankRows (reportingEngine.ts)
 *     - the ONE grouping/ranking function every report/dashboard/AI tool
 *     already shares
 * and produces a ranked list of concrete suggestions, each backed by an
 * ACTUALLY COMPUTED preview value from real, currently-filtered data - never
 * a placeholder, never an LLM-invented number (CRITICAL: no second
 * reporting engine, no duplicated formulas, no fabricated data).
 *
 * Discovery is read-only by construction: every function here only reads
 * UniversalStageRecord[] the caller already fetched and returns plain data -
 * nothing here writes to Firestore, nothing here persists anything (Part 37).
 */
import { UniversalStageRecord, ProductionStageType } from '../types';
import {
  METRIC_REGISTRY, MetricKey, MetricCategory, EntityType, ENTITY_TO_DIMENSION,
  computeRankingForEntity, getMetricLabel, isMetricSupportedForStage,
} from './dashboardRegistry';
import { aggregateByDimension, ALL_STAGES, getStageDisplayName } from './reportingEngine';

export type SuggestionAvailability = 'AVAILABLE' | 'PARTIAL' | 'NOT_AVAILABLE';
export type SuggestionCategory = MetricCategory | 'DATA_QUALITY' | 'ACCOUNTING';

export interface DerivedMetricSuggestion {
  suggestionId: string;
  category: SuggestionCategory;
  titleAr: string;
  titleEn: string;
  benefitAr: string;
  benefitEn: string;
  formulaAr: string;
  formulaEn: string;
  metric?: MetricKey;
  entityType?: EntityType;
  stage: ProductionStageType | 'all';
  scopeLabelAr: string;
  scopeLabelEn: string;
  availability: SuggestionAvailability;
  coverage: { recordCount: number; missingCount: number };
  previewAr: string;
  previewEn: string;
  /** Deterministic, disclosed ranking signal (Part 39) - never a subjective "critical" label without this backing. */
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
}

function genId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

/** Part 7/41 - the ONE null-safe percent-change formula every discovery function below uses; never a fabricated 100%/Infinity when the baseline is 0. */
function safePercentChange(previous: number, current: number): number | null {
  if (previous !== 0) return Number((((current - previous) / previous) * 100).toFixed(1));
  return current !== 0 ? null : 0;
}

/**
 * Part 40-42 - how many of the currently-scoped records actually carry the
 * source field(s) a given metric depends on. The "core" metrics (production/
 * waste/downtime/operations) are required fields on every UniversalStageRecord
 * (populated by stageRecordService.ts's mapper for every stage), so they are
 * always fully covered; the newer optional ones (gas/electricity/labor
 * hours) and the pressing-only fault metrics are genuinely partial/
 * inapplicable outside their real scope - reported honestly, never assumed.
 */
function computeFieldCoverage(records: UniversalStageRecord[], metric: MetricKey): { recordCount: number; missingCount: number } {
  const recordCount = records.length;
  let missingCount = 0;
  switch (metric) {
    case 'GAS_CONSUMPTION':
      missingCount = records.filter((r) => !r.gasConsumption || r.gasConsumption <= 0).length;
      break;
    case 'ELECTRICITY_CONSUMPTION':
      missingCount = records.filter((r) => !r.electricityConsumption || r.electricityConsumption <= 0).length;
      break;
    case 'LABOR_HOURS':
    case 'PRODUCTION_PER_LABOR_HOUR':
      missingCount = records.filter((r) => !(r.workers || []).some((w) => (w.hours || 0) > 0)).length;
      break;
    case 'MECHANICAL_FAULTS':
    case 'ELECTRICAL_FAULTS':
    case 'WORKSHOP_FAULTS':
    case 'RAW_MATERIAL_FAULTS':
    case 'OTHER_FAULTS':
    case 'TOTAL_FAULT_MINUTES':
    case 'FAULT_RATE_PER_TON':
      missingCount = records.filter((r) => r.stageType !== 'pressing').length;
      break;
    default:
      missingCount = 0;
  }
  return { recordCount, missingCount };
}

function availabilityFromCoverage(c: { recordCount: number; missingCount: number }): SuggestionAvailability {
  if (c.recordCount === 0) return 'NOT_AVAILABLE';
  if (c.missingCount === 0) return 'AVAILABLE';
  if (c.missingCount === c.recordCount) return 'NOT_AVAILABLE';
  return 'PARTIAL';
}

function formatValue(n: number, unit: string): string {
  const rounded = Number.isInteger(n) ? String(n) : n.toFixed(2);
  return `${rounded}`;
}

/**
 * Part 4/16 - ONE suggestion per registered metric, showing its real
 * aggregate value over the currently-filtered scope. This directly covers
 * the "search every meaningful metric" ask for every metric already in
 * METRIC_REGISTRY (production/quality/downtime/faults/equipment/employees...)
 * without a second, parallel formula set.
 */
export function discoverMetricSuggestions(
  records: UniversalStageRecord[],
  language: 'ar' | 'en',
  stage: ProductionStageType | 'all' = 'all'
): DerivedMetricSuggestion[] {
  const scoped = stage === 'all' ? records : records.filter((r) => r.stageType === stage);
  const scopeLabelAr = stage === 'all' ? 'المصنع بالكامل (كل المراحل)' : getStageDisplayName(stage, 'ar');
  const scopeLabelEn = stage === 'all' ? 'Factory-wide (all stages)' : getStageDisplayName(stage, 'en');

  return (Object.keys(METRIC_REGISTRY) as MetricKey[])
    .filter((m) => isMetricSupportedForStage(m, stage))
    .map((m) => {
      const def = METRIC_REGISTRY[m];
      const coverage = computeFieldCoverage(scoped, m);
      const availability = availabilityFromCoverage(coverage);
      const usable = availability === 'NOT_AVAILABLE' ? [] : scoped;
      const value = availability === 'NOT_AVAILABLE' ? 0 : def.compute(usable);
      // Both language variants are always computed regardless of the
      // display `language` param - DerivedMetricSuggestion carries BOTH
      // simultaneously (same convention as SAFE_ERROR_MESSAGES etc.
      // elsewhere in this codebase), the caller picks which to render.
      const labelAr = getMetricLabel(m, 'ar');
      const labelEn = getMetricLabel(m, 'en');
      return {
        suggestionId: genId('metric'),
        category: def.category,
        titleAr: labelAr, titleEn: labelEn,
        benefitAr: `متابعة ${labelAr} يساعد في رصد الأداء واتخاذ قرارات مبنية على بيانات حقيقية.`,
        benefitEn: `Tracking ${labelEn} helps monitor performance and make decisions grounded in real data.`,
        formulaAr: METRIC_FORMULA_LABEL_AR[m] || labelAr,
        formulaEn: METRIC_FORMULA_LABEL_EN[m] || labelEn,
        metric: m,
        stage,
        scopeLabelAr, scopeLabelEn,
        availability,
        coverage,
        previewAr: availability === 'NOT_AVAILABLE' ? 'غير متاح لعدم توفر بيانات مصدر كافية.' : `${formatValue(value, def.unit)} ${UNIT_LABEL_AR[def.unit]}`,
        previewEn: availability === 'NOT_AVAILABLE' ? 'Not available - insufficient source data.' : `${formatValue(value, def.unit)} ${UNIT_LABEL_EN[def.unit]}`,
        confidence: availability === 'AVAILABLE' ? 'HIGH' : availability === 'PARTIAL' ? 'MEDIUM' : 'LOW',
      } satisfies DerivedMetricSuggestion;
    })
    .sort((a, b) => (a.availability === b.availability ? 0 : a.availability === 'AVAILABLE' ? -1 : 1));
}

const UNIT_LABEL_AR: Record<string, string> = { TONS: 'طن', PERCENT: '%', MINUTES: 'دقيقة', COUNT: '', KWH: 'ك.و.س', M3: 'م3', HOURS: 'ساعة', TONS_PER_HOUR: 'طن/ساعة' };
const UNIT_LABEL_EN: Record<string, string> = { TONS: 't', PERCENT: '%', MINUTES: 'min', COUNT: '', KWH: 'kWh', M3: 'm3', HOURS: 'h', TONS_PER_HOUR: 't/h' };

const METRIC_FORMULA_LABEL_AR: Partial<Record<MetricKey, string>> = {
  WASTE_RATE: 'الهالك ÷ الإنتاج × 100', EFFICIENCY_RATE: 'الإنتاج السليم ÷ الإنتاج × 100',
  FAULT_RATE_PER_TON: 'إجمالي دقائق الأعطال ÷ الإنتاج', DOWNTIME_RATE_PER_TON: 'دقائق التوقف ÷ الإنتاج',
  PRODUCTION_PER_LABOR_HOUR: 'الإنتاج ÷ ساعات العمل', AVG_PRODUCTION_PER_GROUP: 'الإنتاج ÷ عدد التشغيلات',
};
const METRIC_FORMULA_LABEL_EN: Partial<Record<MetricKey, string>> = {
  WASTE_RATE: 'waste ÷ production × 100', EFFICIENCY_RATE: 'good production ÷ production × 100',
  FAULT_RATE_PER_TON: 'total fault minutes ÷ production', DOWNTIME_RATE_PER_TON: 'downtime minutes ÷ production',
  PRODUCTION_PER_LABOR_HOUR: 'production ÷ labor hours', AVG_PRODUCTION_PER_GROUP: 'production ÷ operations count',
};

/**
 * Part 9/17/23 - curated (metric, dimension) pairs, NOT the full combinatorial
 * cross-product (which would be mostly noise - e.g. "customer waste rate for
 * the Mixing stage" is rarely meaningful). Each pair mirrors an explicit
 * example from the task's own list ("production per employee/shift/press/
 * product/customer", "waste by employee/press/shift/product/customer",
 * "downtime by employee/press/stage/shift").
 */
const DIMENSION_SUGGESTION_PAIRS: { metric: MetricKey; entityType: EntityType }[] = [
  { metric: 'PRODUCTION_TONS', entityType: 'EMPLOYEE' },
  { metric: 'PRODUCTION_TONS', entityType: 'SHIFT' },
  { metric: 'PRODUCTION_TONS', entityType: 'EQUIPMENT' },
  { metric: 'PRODUCTION_TONS', entityType: 'PRODUCT' },
  { metric: 'PRODUCTION_TONS', entityType: 'CUSTOMER' },
  { metric: 'WASTE_TONS', entityType: 'EMPLOYEE' },
  { metric: 'WASTE_TONS', entityType: 'EQUIPMENT' },
  { metric: 'WASTE_TONS', entityType: 'PRODUCT' },
  { metric: 'WASTE_RATE', entityType: 'EQUIPMENT' },
  { metric: 'DOWNTIME_MINUTES', entityType: 'EQUIPMENT' },
  { metric: 'DOWNTIME_MINUTES', entityType: 'SHIFT' },
  { metric: 'EFFICIENCY_RATE', entityType: 'EMPLOYEE' },
  { metric: 'EFFICIENCY_RATE', entityType: 'EQUIPMENT' },
  { metric: 'TOTAL_FAULT_MINUTES', entityType: 'EQUIPMENT' },
];

const ENTITY_LABEL_AR: Record<EntityType, string> = { EMPLOYEE: 'الموظف', SHIFT: 'الوردية', EQUIPMENT: 'المعدة/المكبس', PRODUCT: 'المنتج', CUSTOMER: 'العميل', STAGE: 'المرحلة' };
const ENTITY_LABEL_EN: Record<EntityType, string> = { EMPLOYEE: 'Employee', SHIFT: 'Shift', EQUIPMENT: 'Equipment/Press', PRODUCT: 'Product', CUSTOMER: 'Customer', STAGE: 'Stage' };

/**
 * Part 9/13/23 - "X by Y" breakdown suggestions (production per employee,
 * waste by press, ...). The preview is the REAL top-ranked result via the
 * SAME computeRankingForEntity() the Dashboard Builder's ranking widgets
 * already use - never a separate ranking formula.
 */
export function discoverDimensionSuggestions(
  records: UniversalStageRecord[],
  language: 'ar' | 'en',
  stage: ProductionStageType | 'all' = 'all'
): DerivedMetricSuggestion[] {
  const scoped = stage === 'all' ? records : records.filter((r) => r.stageType === stage);
  const scopeLabelAr = stage === 'all' ? 'المصنع بالكامل (كل المراحل)' : getStageDisplayName(stage, 'ar');
  const scopeLabelEn = stage === 'all' ? 'Factory-wide (all stages)' : getStageDisplayName(stage, 'en');

  return DIMENSION_SUGGESTION_PAIRS
    .filter((p) => isMetricSupportedForStage(p.metric, stage))
    .map((p) => {
      const def = METRIC_REGISTRY[p.metric];
      const coverage = computeFieldCoverage(scoped, p.metric);
      const availability = availabilityFromCoverage(coverage);
      const dimension = ENTITY_TO_DIMENSION[p.entityType];
      const rows = availability === 'NOT_AVAILABLE' ? [] : aggregateByDimension(scoped, dimension, language);
      const top = availability === 'NOT_AVAILABLE' ? undefined : computeRankingForEntity(scoped, p.entityType, p.metric, def.lowerIsBetter ? 'worst' : 'best', 1, language)[0];
      // Both language variants always computed regardless of the display
      // `language` param - see discoverMetricSuggestions' identical note.
      const metricLabelAr = getMetricLabel(p.metric, 'ar');
      const metricLabelEn = getMetricLabel(p.metric, 'en');
      const titleAr = `${metricLabelAr} حسب ${ENTITY_LABEL_AR[p.entityType]}`;
      const titleEn = `${metricLabelEn} by ${ENTITY_LABEL_EN[p.entityType]}`;
      // Recomputes the metric directly over the top row's own records (never
      // assumes a fixed AggregatedReportRow field - EFFICIENCY_RATE/
      // TOTAL_FAULT_MINUTES have no such field, so this is the one path that
      // works correctly for every metric in the catalog).
      const topValue = top ? def.compute(top.records) : undefined;
      return {
        suggestionId: genId('dim'),
        category: def.category,
        titleAr, titleEn,
        benefitAr: `يساعد في تحديد ${ENTITY_LABEL_AR[p.entityType]} الأعلى/الأقل أداءً من حيث ${metricLabelAr}.`,
        benefitEn: `Helps identify which ${ENTITY_LABEL_EN[p.entityType].toLowerCase()} performs best/worst on ${metricLabelEn}.`,
        formulaAr: `تجميع ${metricLabelAr} حسب ${ENTITY_LABEL_AR[p.entityType]} ثم الترتيب`,
        formulaEn: `Group ${metricLabelEn} by ${ENTITY_LABEL_EN[p.entityType]}, then rank`,
        metric: p.metric,
        entityType: p.entityType,
        stage,
        scopeLabelAr, scopeLabelEn,
        availability,
        coverage,
        previewAr: !top ? 'لا توجد بيانات كافية للعرض.' : `الأعلى: ${top.label || 'غير محدد'} (${formatValue(topValue ?? 0, def.unit)} ${UNIT_LABEL_AR[def.unit]})`,
        previewEn: !top ? 'Not enough data to display.' : `Top: ${top.label || 'Unspecified'} (${formatValue(topValue ?? 0, def.unit)} ${UNIT_LABEL_EN[def.unit]})`,
        confidence: availability === 'AVAILABLE' && rows.length >= 2 ? 'HIGH' : availability === 'NOT_AVAILABLE' ? 'LOW' : 'MEDIUM',
      } satisfies DerivedMetricSuggestion;
    });
}

const TREND_METRICS: MetricKey[] = ['PRODUCTION_TONS', 'WASTE_TONS', 'WASTE_RATE', 'DOWNTIME_MINUTES', 'EFFICIENCY_RATE'];

/**
 * Part 5/39 - PERCENT_CHANGE / TREND derivation, reusing the exact
 * zero-baseline-safe formula every other period-comparison in this codebase
 * uses (never a fabricated 100%/Infinity - Part 7).
 */
export function discoverTrendSuggestions(
  currentRecords: UniversalStageRecord[],
  previousRecords: UniversalStageRecord[],
  language: 'ar' | 'en',
  stage: ProductionStageType | 'all' = 'all'
): DerivedMetricSuggestion[] {
  const scopeLabelAr = stage === 'all' ? 'المصنع بالكامل (كل المراحل)' : getStageDisplayName(stage, 'ar');
  const scopeLabelEn = stage === 'all' ? 'Factory-wide (all stages)' : getStageDisplayName(stage, 'en');
  const curScoped = stage === 'all' ? currentRecords : currentRecords.filter((r) => r.stageType === stage);
  const prevScoped = stage === 'all' ? previousRecords : previousRecords.filter((r) => r.stageType === stage);

  return TREND_METRICS.filter((m) => isMetricSupportedForStage(m, stage)).map((m) => {
    const def = METRIC_REGISTRY[m];
    const coverage = computeFieldCoverage(curScoped, m);
    const availability = availabilityFromCoverage(coverage);
    const current = availability === 'NOT_AVAILABLE' ? 0 : def.compute(curScoped);
    const previous = availability === 'NOT_AVAILABLE' ? 0 : def.compute(prevScoped);
    const pct = safePercentChange(previous, current);
    const labelAr = getMetricLabel(m, 'ar');
    const labelEn = getMetricLabel(m, 'en');
    const pctTextAr = pct === null ? 'غير قابل للحساب (لا توجد بيانات في الفترة السابقة)' : `${pct >= 0 ? '+' : ''}${pct}%`;
    const pctTextEn = pct === null ? 'Not computable (no data in the prior period)' : `${pct >= 0 ? '+' : ''}${pct}%`;
    return {
      suggestionId: genId('trend'),
      category: def.category,
      titleAr: `اتجاه ${labelAr}`, titleEn: `${labelEn} Trend`,
      benefitAr: `يوضح ما إذا كان ${labelAr} في تحسّن أو تراجع مقارنة بالفترة السابقة المكافئة.`,
      benefitEn: `Shows whether ${labelEn} is improving or declining vs. the equal-length prior period.`,
      formulaAr: '(القيمة الحالية − القيمة السابقة) ÷ القيمة السابقة × 100',
      formulaEn: '(current − previous) ÷ previous × 100',
      metric: m,
      stage,
      scopeLabelAr, scopeLabelEn,
      availability,
      coverage,
      previewAr: availability === 'NOT_AVAILABLE' ? 'غير متاح.' : `${formatValue(current, def.unit)} ${UNIT_LABEL_AR[def.unit]} (${pctTextAr} مقارنة بـ ${formatValue(previous, def.unit)})`,
      previewEn: availability === 'NOT_AVAILABLE' ? 'Not available.' : `${formatValue(current, def.unit)} ${UNIT_LABEL_EN[def.unit]} (${pctTextEn} vs. ${formatValue(previous, def.unit)})`,
      confidence: pct === null ? 'LOW' : Math.abs(pct) >= 20 ? 'HIGH' : 'MEDIUM',
    } satisfies DerivedMetricSuggestion;
  });
}

export interface DataQualityFinding {
  findingId: string;
  titleAr: string; titleEn: string;
  descriptionAr: string; descriptionEn: string;
  affectedCount: number;
  severity: 'INFO' | 'WARNING';
}

/**
 * Part 15/29 - honest, read-only data-quality checks over the CURRENT
 * scope's records. Never auto-corrects anything (Part 15: "Do not modify
 * production data automatically") - these are findings to review, exactly
 * like every other suggestion here.
 */
export function discoverDataQualityFindings(records: UniversalStageRecord[]): DataQualityFinding[] {
  const findings: DataQualityFinding[] = [];
  const missingProduct = records.filter((r) => !r.productId && !r.productName).length;
  if (missingProduct > 0) {
    findings.push({
      findingId: genId('dq'),
      titleAr: 'سجلات بلا منتج محدد', titleEn: 'Records with no linked product',
      descriptionAr: `${missingProduct} سجل بدون معرف أو اسم منتج - قد يحد ذلك من دقة التحليل حسب المنتج.`,
      descriptionEn: `${missingProduct} record(s) have no product id or name - this limits the accuracy of any per-product analysis.`,
      affectedCount: missingProduct, severity: 'WARNING',
    });
  }
  const missingDate = records.filter((r) => !r.date).length;
  if (missingDate > 0) {
    findings.push({
      findingId: genId('dq'),
      titleAr: 'سجلات بلا تاريخ', titleEn: 'Records with no date',
      descriptionAr: `${missingDate} سجل بدون تاريخ - لا يمكن إدراجها بدقة في أي تحليل زمني/فترة.`,
      descriptionEn: `${missingDate} record(s) have no date - they cannot be accurately placed in any period/trend analysis.`,
      affectedCount: missingDate, severity: 'WARNING',
    });
  }
  const negativeProduction = records.filter((r) => (r.productionTons ?? 0) < 0 || (r.wasteTons ?? 0) < 0).length;
  if (negativeProduction > 0) {
    findings.push({
      findingId: genId('dq'),
      titleAr: 'قيم إنتاج/هالك سالبة', titleEn: 'Negative production/waste values',
      descriptionAr: `${negativeProduction} سجل بقيمة إنتاج أو هالك سالبة - قيمة غير منطقية تستدعي المراجعة.`,
      descriptionEn: `${negativeProduction} record(s) have a negative production or waste value - a physically impossible value that warrants review.`,
      affectedCount: negativeProduction, severity: 'WARNING',
    });
  }
  const noWorkers = records.filter((r) => !r.workers || r.workers.length === 0).length;
  if (noWorkers > 0) {
    findings.push({
      findingId: genId('dq'),
      titleAr: 'سجلات بلا عمال مسجلين', titleEn: 'Records with no recorded workers',
      descriptionAr: `${noWorkers} سجل بدون عمال مرتبطين - يحد من دقة تحليلات الأداء حسب الموظف.`,
      descriptionEn: `${noWorkers} record(s) have no linked workers - this limits the accuracy of any per-employee analysis.`,
      affectedCount: noWorkers, severity: 'INFO',
    });
  }
  if (findings.length === 0) {
    findings.push({
      findingId: genId('dq'),
      titleAr: 'لا توجد ملاحظات جودة بيانات', titleEn: 'No data-quality findings',
      descriptionAr: 'لم يتم رصد سجلات ناقصة أو غير منطقية ضمن النطاق الحالي.',
      descriptionEn: 'No incomplete or implausible records were found in the current scope.',
      affectedCount: 0, severity: 'INFO',
    });
  }
  return findings;
}

/**
 * Part 14/44 - accounting/cost-based derivations are explicitly NOT
 * AVAILABLE: the current Product/Customer data model (src/types/index.ts)
 * carries no price, cost, or rate field anywhere, and MaterialConsumptionItem
 * carries no cost either - only physical quantities. Returning a real,
 * disclosed NOT_AVAILABLE list here (rather than silently omitting the
 * category) is itself the honest answer Part 14 requires: never invent a
 * cost/price/rate that isn't backed by real stored data.
 */
export function discoverAccountingFindings(language: 'ar' | 'en'): DerivedMetricSuggestion[] {
  const items: { titleAr: string; titleEn: string; reasonAr: string; reasonEn: string }[] = [
    { titleAr: 'قيمة الإنتاج', titleEn: 'Production Value', reasonAr: 'لا يوجد سعر/تكلفة للطن مخزّن في بيانات المنتجات حاليًا.', reasonEn: 'No per-ton price/cost is currently stored on Product records.' },
    { titleAr: 'تكلفة الهالك', titleEn: 'Waste Cost', reasonAr: 'يتطلب سعر/تكلفة للوحدة غير متوفر في نموذج البيانات الحالي.', reasonEn: 'Requires a unit price/cost that does not exist in the current data model.' },
    { titleAr: 'تكلفة التوقف', titleEn: 'Downtime Cost', reasonAr: 'يتطلب معدل تكلفة تشغيل بالساعة غير مسجل حاليًا.', reasonEn: 'Requires an hourly operating-cost rate that is not currently recorded.' },
    { titleAr: 'تكلفة العمالة', titleEn: 'Labor Cost', reasonAr: 'ساعات العمل مسجلة، لكن لا يوجد أجر/معدل تكلفة للساعة في بيانات الموظفين.', reasonEn: 'Labor hours are recorded, but no wage/hourly-cost rate exists on Employee records.' },
  ];
  return items.map((it) => ({
    suggestionId: genId('acct'),
    category: 'ACCOUNTING' as SuggestionCategory,
    titleAr: it.titleAr, titleEn: it.titleEn,
    benefitAr: 'مؤشر محاسبي محتمل - غير متاح حاليًا بسبب نقص بيانات المصدر.',
    benefitEn: 'A potentially useful accounting indicator - currently unavailable due to missing source data.',
    formulaAr: it.reasonAr, formulaEn: it.reasonEn,
    stage: 'all' as const,
    scopeLabelAr: 'المصنع بالكامل', scopeLabelEn: 'Factory-wide',
    availability: 'NOT_AVAILABLE' as SuggestionAvailability,
    coverage: { recordCount: 0, missingCount: 0 },
    previewAr: 'غير متاح: ' + it.reasonAr,
    previewEn: 'Not available: ' + it.reasonEn,
    confidence: 'LOW' as const,
  }));
}

/** All 8 stages, for callers that want to offer a stage picker (Part 23). */
export { ALL_STAGES };

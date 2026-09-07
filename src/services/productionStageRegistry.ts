/**
 * Production Stage Registry (Part 10) - formalizes what future production
 * stages need to register to work with the Dashboard/Report Builder without
 * any changes to the builder itself: display names, which metrics apply,
 * which entity dimensions are meaningful, a default widget set for a new
 * stage's dashboard section, and which chart types make sense.
 *
 * This is a THIN aggregation layer, not new logic - it reads straight from
 * the registries that already carry this extensibility (reportingEngine.ts's
 * ALL_STAGES/getStageDisplayName, dashboardRegistry.ts's METRIC_REGISTRY
 * supportedStages, ENTITY_TO_DIMENSION). Adding stage #9 means: (1) teach
 * fetchUniversalStageRecords() to read its collection into
 * UniversalStageRecord (already how stages 1-8 work), and (2) add one entry
 * here declaring which of the existing metrics/entities/charts apply to it -
 * the Dashboard Builder, Reports screen, and AI designer all pick it up
 * automatically since they only ever read this registry, never a
 * stage-specific switch statement.
 */
import { ProductionStageType } from '../types';
import { ALL_STAGES, getStageDisplayName } from './reportingEngine';
import { MetricKey, METRIC_REGISTRY, EntityType, ChartType, isMetricSupportedForStage } from './dashboardRegistry';

export interface ProductionStageRegistration {
  stage: ProductionStageType;
  nameAr: string;
  nameEn: string;
  /** Metrics genuinely meaningful for this stage (derived from METRIC_REGISTRY's own supportedStages - never hand-duplicated). */
  supportedMetrics: MetricKey[];
  /** Entity dimensions worth grouping/ranking by for this stage. All 6 apply by default; a future stage with no customer-facing output (e.g. an internal prep stage) could register fewer. */
  supportedEntities: EntityType[];
  /** A sensible default widget set for a brand-new dashboard section covering this stage. */
  defaultMetrics: MetricKey[];
  /** Chart types this stage's data supports well - all standard types apply since every stage produces the same UniversalStageRecord shape. */
  recommendedChartTypes: ChartType[];
}

const ALL_ENTITIES: EntityType[] = ['EMPLOYEE', 'SHIFT', 'EQUIPMENT', 'PRODUCT', 'CUSTOMER', 'STAGE'];
const STANDARD_CHART_TYPES: ChartType[] = ['BAR', 'HORIZONTAL_BAR', 'LINE', 'AREA', 'DONUT', 'TABLE', 'KPI', 'RANKING_LIST'];

function buildRegistration(stage: ProductionStageType): ProductionStageRegistration {
  const supportedMetrics = (Object.keys(METRIC_REGISTRY) as MetricKey[]).filter((m) => isMetricSupportedForStage(m, stage));
  return {
    stage,
    nameAr: getStageDisplayName(stage, 'ar'),
    nameEn: getStageDisplayName(stage, 'en'),
    supportedMetrics,
    supportedEntities: ALL_ENTITIES,
    defaultMetrics: (['PRODUCTION_TONS', 'WASTE_RATE', 'EFFICIENCY_RATE'] as MetricKey[]).filter((m) => supportedMetrics.includes(m)),
    recommendedChartTypes: STANDARD_CHART_TYPES,
  };
}

/** One registration per real production stage - built once from the existing ALL_STAGES list, not hand-maintained. */
export const PRODUCTION_STAGE_REGISTRY: Record<ProductionStageType, ProductionStageRegistration> = ALL_STAGES.reduce((acc, stage) => {
  acc[stage] = buildRegistration(stage);
  return acc;
}, {} as Record<ProductionStageType, ProductionStageRegistration>);

export function getStageRegistration(stage: ProductionStageType): ProductionStageRegistration {
  return PRODUCTION_STAGE_REGISTRY[stage] || buildRegistration(stage);
}

export function listRegisteredStages(): ProductionStageRegistration[] {
  return ALL_STAGES.map((s) => PRODUCTION_STAGE_REGISTRY[s]);
}

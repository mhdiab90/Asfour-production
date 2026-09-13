/**
 * Dashboard Builder - Widget / Metric / Chart Registry (Part 1-5, 10, 31).
 *
 * This is the ONE structured vocabulary the Dashboard Builder UI, the saved
 * dashboard persistence layer, and the AI Report Designer all share. A
 * dashboard is JUST data (DashboardLayout -> DashboardSection[] ->
 * WidgetConfig[]) - nothing here is React, nothing here is AI-provider
 * specific, and the AI can only ever produce values from these registries
 * (never arbitrary code), satisfying §26/CRITICAL.
 *
 * Data computation reuses reportingEngine.ts's aggregateByDimension()/
 * rankRows()/filterUniversalRecords() on top of fetchUniversalStageRecords()
 * - the SAME functions the Reports screen and the AI's stage tools already
 * use, so a Dashboard Builder number can never diverge from a Reports number
 * for the same query (§: "do not create duplicate reporting engines").
 */
import { ProductionStageType, UniversalStageRecord } from '../types';
import {
  ReportDimension,
  AggregatedReportRow,
  aggregateByDimension,
  rankRows,
  RankingMetric,
  ALL_STAGES,
  getStageDisplayName,
} from './reportingEngine';
import { resolveNamedMonthRange } from '../assistant/tools/dateRangeResolver';

// ============================================================================
// Widget vocabulary
// ============================================================================

export type WidgetType = 'KPI_CARD' | 'RANKING' | 'COMPARISON' | 'CHART' | 'TABLE';

export type ChartType =
  | 'BAR' | 'HORIZONTAL_BAR' | 'GROUPED_BAR' | 'STACKED_BAR'
  | 'LINE' | 'MULTI_LINE' | 'AREA' | 'STACKED_AREA'
  | 'PIE' | 'DONUT' | 'SCATTER' | 'HEATMAP' | 'RADAR' | 'COMBO'
  | 'TABLE' | 'KPI' | 'RANKING_LIST';

/** The ONE authoritative chart-type list (Part 22 CRITICAL: "derive allowed chart types from the actual Dashboard Builder enum/schema, never hardcode unsupported types") - ChartGalleryPicker.tsx, WidgetConfigForm.tsx, and the AI's setCustomDashboardWidget tool all read from this single array. */
export const ALL_CHART_TYPES: ChartType[] = ['BAR', 'HORIZONTAL_BAR', 'GROUPED_BAR', 'STACKED_BAR', 'LINE', 'MULTI_LINE', 'AREA', 'STACKED_AREA', 'PIE', 'DONUT', 'SCATTER', 'HEATMAP', 'RADAR', 'COMBO', 'TABLE', 'KPI', 'RANKING_LIST'];

/** Bilingual chart-type labels - the ONE copy (previously duplicated as a module-private const in ChartGalleryPicker.tsx), reused by both that component and the AI's chart-type choice/apply tools so a chat option label always matches what the UI itself shows. */
export const CHART_TYPE_LABELS: Record<ChartType, { ar: string; en: string; descAr: string; descEn: string }> = {
  BAR: { ar: 'أعمدة', en: 'Bar Chart', descAr: 'مقارنة فئات', descEn: 'Compare categories' },
  HORIZONTAL_BAR: { ar: 'أعمدة أفقية', en: 'Horizontal Bar', descAr: 'مناسب للترتيب', descEn: 'Good for rankings' },
  GROUPED_BAR: { ar: 'أعمدة مجمعة', en: 'Grouped Bar', descAr: 'مقارنة بين فترتين/عناصر', descEn: 'Compare two periods/entities' },
  STACKED_BAR: { ar: 'أعمدة متراكمة', en: 'Stacked Bar', descAr: 'تركيبة الإجمالي', descEn: 'Composition of a total' },
  LINE: { ar: 'خطي', en: 'Line Chart', descAr: 'اتجاه عبر الزمن', descEn: 'Trend over time' },
  MULTI_LINE: { ar: 'خطوط متعددة', en: 'Multi-Line', descAr: 'مقارنة اتجاهات متعددة', descEn: 'Compare multiple trends' },
  AREA: { ar: 'مساحي', en: 'Area Chart', descAr: 'اتجاه بحجم بصري', descEn: 'Trend with visual volume' },
  STACKED_AREA: { ar: 'مساحي متراكم', en: 'Stacked Area', descAr: 'تركيبة عبر الزمن', descEn: 'Composition over time' },
  PIE: { ar: 'دائري', en: 'Pie Chart', descAr: 'نسب من الإجمالي', descEn: 'Proportions of a total' },
  DONUT: { ar: 'دائري مفرغ', en: 'Donut Chart', descAr: 'تركيبة بعدد قليل من الفئات', descEn: 'Composition of few categories' },
  SCATTER: { ar: 'نقطي', en: 'Scatter Plot', descAr: 'علاقة بين متغيرين رقميين', descEn: 'Relationship between two numeric variables' },
  HEATMAP: { ar: 'خريطة حرارية', en: 'Heatmap', descAr: 'مقارنة بعدين معًا', descEn: 'Compare two dimensions at once' },
  RADAR: { ar: 'راداري', en: 'Radar Chart', descAr: 'توازن عدة مقاييس', descEn: 'Balance of several metrics' },
  COMBO: { ar: 'مركب', en: 'Combo Chart', descAr: 'دمج أعمدة وخط', descEn: 'Bars combined with a line' },
  TABLE: { ar: 'جدول', en: 'Table', descAr: 'أفضل لعدد كبير من العناصر', descEn: 'Best for many items' },
  KPI: { ar: 'بطاقة مؤشر', en: 'KPI Card', descAr: 'قيمة مفردة بارزة', descEn: 'A single prominent value' },
  RANKING_LIST: { ar: 'قائمة ترتيب', en: 'Ranking List', descAr: 'قائمة مرتبة بأشرطة تقدم', descEn: 'A ranked list with progress bars' },
};

export type EntityType = 'EMPLOYEE' | 'SHIFT' | 'EQUIPMENT' | 'PRODUCT' | 'CUSTOMER' | 'STAGE';

/** Maps a widget's entity choice onto reportingEngine's grouping dimension - one vocabulary, not two. */
export const ENTITY_TO_DIMENSION: Record<EntityType, ReportDimension> = {
  EMPLOYEE: 'employee', SHIFT: 'shift', EQUIPMENT: 'equipment', PRODUCT: 'product', CUSTOMER: 'customer', STAGE: 'stage',
};

export type AnalysisMode = 'SINGLE_METRIC' | 'MULTI_METRIC' | 'RANKING' | 'COMPARISON' | 'TREND' | 'PERIOD_COMPARISON' | 'CROSS_TAB';

export type TimeRangePreset = 'TODAY' | 'YESTERDAY' | 'THIS_WEEK' | 'LAST_WEEK' | 'LAST_7_DAYS' | 'THIS_MONTH' | 'LAST_MONTH' | 'LAST_30_DAYS' | 'LAST_3_MONTHS' | 'LAST_6_MONTHS' | 'THIS_YEAR' | 'ALL_TIME' | 'NAMED_MONTH' | 'CUSTOM';

export interface WidgetFilters {
  startDate?: string;
  endDate?: string;
  stageType?: ProductionStageType | 'all';
  shiftId?: string;
  employeeId?: string;
  productId?: string;
  customerId?: string;
  pressId?: string;
}

export interface WidgetConfig {
  widgetId: string;
  widgetType: WidgetType;
  /** User-entered custom title - genuine business/user data, never auto-translated (§ Data vs System Language). Falls back to the auto-generated bilingual label when absent. */
  customTitle?: string;
  analysisMode: AnalysisMode;
  metric: MetricKey;
  /** Extra metrics shown alongside the primary one in a MULTI_METRIC panel (§3/Part 3). */
  secondaryMetrics?: MetricKey[];
  entityType?: EntityType;
  rankingDirection?: 'best' | 'worst';
  limit?: number;
  chartType: ChartType;
  /** True when the user explicitly picked chartType themselves rather than accepting the recommendation - kept so the UI can show "(custom)" vs "(recommended)". */
  chartTypeIsOverride?: boolean;
  /** 'inherit' = follow the dashboard's global time range (default for new widgets). */
  timeRangePreset: TimeRangePreset | 'inherit';
  filters: WidgetFilters;
  /** 'inherit' = follow the dashboard's global stage filter (default for new widgets). */
  productionStage: ProductionStageType | 'all' | 'inherit';
  /** Specific entity ids to compare, for COMPARISON mode (§9) - e.g. two specific presses. Empty = compare the top N by the ranking instead. */
  compareEntityIds?: string[];
  /** Period-vs-period comparison (§10). */
  comparePeriods?: { labelA: string; startA: string; endA: string; labelB: string; startB: string; endB: string };
  refreshInterval?: number;
  /** Tile size within its section's grid (Part 1 §4) - SMALL/MEDIUM occupy 1/2 grid cells, LARGE spans the full section width. Defaults to MEDIUM for new widgets. */
  size?: WidgetSize;
}

export type WidgetSize = 'SMALL' | 'MEDIUM' | 'LARGE';

export interface DashboardSection {
  sectionId: string;
  title: string;
  /** User-facing description (Part 2 §7) - optional, shown under the section title. */
  description?: string;
  columns: 1 | 2 | 3 | 4;
  widgets: WidgetConfig[];
}

export interface DashboardLayout {
  dashboardId: string;
  /**
   * Phase 4B §2 - the "لوحة 1"/"لوحة 2" human-friendly number the AI (and,
   * in principle, a future UI label) resolves "استخدم اللوحة رقم 1" against.
   * No such number existed before this field - `dashboardId` is an opaque
   * generated string, and the Dashboard Builder's default NAME ("New
   * Dashboard N") only ever reused `dashboards.length + 1` at creation time,
   * which is NOT a stable identifier (renaming or reordering would break
   * it). Assigned once at creation (dashboardPersistenceService.ts's
   * saveDashboard()), NEVER reassigned on update, and lazily backfilled for
   * any pre-existing dashboard that predates this field so no two dashboards
   * can ever collide on the same number.
   */
  dashboardNumber: number;
  name: string;
  /** Optional description shown in the Saved Dashboards manager (Part 3 §9). */
  description?: string;
  sections: DashboardSection[];
  isDefault?: boolean;
  /** Sorted to the top of the Saved Dashboards list (Part 3 §13) - per-browser like the rest of this persistence layer, not a cross-device user preference. */
  isFavorite?: boolean;
  /** Display name of who created this dashboard (Part 3 §9 "Owner") - a snapshot at creation time, not a live foreign key. */
  ownerName?: string;
  /** True for a saved layout created via the Report Builder (Part 6) - governs which templates/print defaults apply. A report is otherwise the SAME DashboardLayout structure, rendered by the SAME WidgetRenderer - no parallel engine. */
  isReport?: boolean;
  /** Recommended print orientation for a report layout (Part 7 §28). */
  printOrientation?: 'portrait' | 'landscape';
  /**
   * Phase 4B §5/§6 - the PERSISTED default filter set this dashboard opens
   * with. Absent = "no persisted default yet" (the Dashboard Builder falls
   * back to its own hardcoded THIS_MONTH/all default, exactly as before this
   * field existed). Only ever written by an EXPLICIT save/persist action
   * (never by a temporary view-only filter change) - see saveCustomDashboardChanges.
   */
  defaultFilters?: GlobalDashboardFilters;
  createdAt: string;
  updatedAt: string;
}

/**
 * Resolves a widget's index in its section's flat array into a virtual grid
 * row/col using the section's column count, then computes the neighbor
 * index for a 4-direction move (Part 1 §3, §2). Up/Down jump by a full row
 * (±columns); Left/Right move one cell within the SAME row only (never wrap
 * into the row above/below) - this is what makes the four directions
 * genuinely distinct, rather than Up/Down and Left/Right collapsing to the
 * same "swap with array-adjacent item" behavior.
 */
export function computeGridMoveTarget(
  index: number,
  totalCount: number,
  columns: number,
  direction: 'up' | 'down' | 'left' | 'right'
): number | null {
  const col = index % columns;
  let target: number;
  if (direction === 'up') target = index - columns;
  else if (direction === 'down') target = index + columns;
  else if (direction === 'left') target = col > 0 ? index - 1 : -1;
  else target = col < columns - 1 ? index + 1 : -1;
  if (target < 0 || target >= totalCount) return null;
  return target;
}

/** Grid column-span for a widget's size within its section's own column count (Part 1 §4). */
export function widgetSpanForSize(size: WidgetSize | undefined, sectionColumns: number): number {
  if (size === 'LARGE') return sectionColumns;
  if (size === 'SMALL') return 1;
  return Math.max(1, Math.min(2, sectionColumns)); // MEDIUM (default)
}

/**
 * Two widgets are cross-filter compatible (Part 3 §8) when they share the
 * SAME entity dimension (e.g. both grouped by Equipment) - clicking "Press =
 * Lais 2000" in one only makes sense to propagate to another widget that is
 * ALSO sliced by press/equipment. A widget with no entityType (a plain KPI
 * total) or a different dimension is left unchanged, exactly as specified.
 */
export function isCrossFilterCompatible(widget: WidgetConfig, filterEntityType: EntityType): boolean {
  return widget.entityType === filterEntityType;
}

/** Active dashboard-wide cross-filter (Part 3 §8) - set by clicking a chart element, cleared explicitly. */
export interface CrossFilterState {
  entityType: EntityType;
  key: string;
  label: string;
  sourceWidgetId: string;
}

// ============================================================================
// Metric Registry (§5) - every metric declares HOW to compute itself from an
// already-filtered UniversalStageRecord[] group, and which stages genuinely
// support it. Fault-type breakdown is only meaningful for Pressing today
// (the only stage whose raw data carries a mechanical/electrical/workshop/
// raw-material/other split) - it is NOT fabricated for the other 7 stages.
// ============================================================================

export type MetricKey =
  | 'PRODUCTION_TONS' | 'GOOD_TONS' | 'WASTE_TONS' | 'WASTE_RATE'
  | 'OPERATIONS_COUNT' | 'DOWNTIME_MINUTES' | 'EFFICIENCY_RATE'
  | 'AVG_PRODUCTION_PER_GROUP'
  | 'MECHANICAL_FAULTS' | 'ELECTRICAL_FAULTS' | 'WORKSHOP_FAULTS' | 'RAW_MATERIAL_FAULTS' | 'OTHER_FAULTS'
  // Universal Data Intelligence pass - genuinely new metrics, each backed by
  // a real field already stored on UniversalStageRecord (gasConsumption/
  // electricityConsumption/workers[].hours/the 5 fault categories summed) -
  // no invented data, no new formulas beyond a safe SUM/RATE over existing
  // numbers (Part 6/Part 44: never fabricate a metric or formula).
  | 'TOTAL_FAULT_MINUTES' | 'FAULT_RATE_PER_TON' | 'DOWNTIME_RATE_PER_TON'
  | 'GAS_CONSUMPTION' | 'ELECTRICITY_CONSUMPTION'
  | 'LABOR_HOURS' | 'PRODUCTION_PER_LABOR_HOUR';

/**
 * Universal Data Intelligence pass (Part 4) - groups every metric into the
 * category vocabulary the Suggested Analytics screen organizes by (Part 22).
 * Purely additive metadata; existing MetricDef consumers that don't read
 * `category` are unaffected.
 */
export type MetricCategory =
  | 'PRODUCTION' | 'QUALITY' | 'DOWNTIME' | 'FAULTS' | 'EMPLOYEES'
  | 'EQUIPMENT' | 'SHIFTS' | 'PRODUCTS' | 'CUSTOMERS' | 'STAGES' | 'OTHER';

export interface MetricDef {
  key: MetricKey;
  labelAr: string;
  labelEn: string;
  unit: 'TONS' | 'PERCENT' | 'MINUTES' | 'COUNT' | 'KWH' | 'M3' | 'HOURS' | 'TONS_PER_HOUR';
  /** Lower values are the "better" ranking direction (e.g. waste, downtime). */
  lowerIsBetter: boolean;
  /** Stages this metric is meaningful for - 'all' or a specific subset (fault breakdown = pressing only). */
  supportedStages: ProductionStageType[] | 'all';
  /** Which Suggested Analytics category this metric is grouped under (Part 4/22). */
  category: MetricCategory;
  compute: (rows: UniversalStageRecord[]) => number;
}

function sumField(rows: UniversalStageRecord[], field: keyof UniversalStageRecord): number {
  return rows.reduce((s, r) => s + (Number(r[field]) || 0), 0);
}
function sumRawField(rows: UniversalStageRecord[], field: string): number {
  return rows.reduce((s, r) => s + (Number(r.rawData?.[field]) || 0), 0);
}

export const METRIC_REGISTRY: Record<MetricKey, MetricDef> = {
  PRODUCTION_TONS: {
    key: 'PRODUCTION_TONS', labelAr: 'إجمالي الإنتاج', labelEn: 'Total Production', unit: 'TONS', lowerIsBetter: false, supportedStages: 'all', category: 'PRODUCTION',
    compute: (rows) => sumField(rows, 'productionTons'),
  },
  GOOD_TONS: {
    key: 'GOOD_TONS', labelAr: 'الإنتاج السليم', labelEn: 'Good Production', unit: 'TONS', lowerIsBetter: false, supportedStages: 'all', category: 'QUALITY',
    compute: (rows) => sumField(rows, 'goodTons'),
  },
  WASTE_TONS: {
    key: 'WASTE_TONS', labelAr: 'الهالك', labelEn: 'Waste', unit: 'TONS', lowerIsBetter: true, supportedStages: 'all', category: 'QUALITY',
    compute: (rows) => sumField(rows, 'wasteTons'),
  },
  WASTE_RATE: {
    key: 'WASTE_RATE', labelAr: 'نسبة الهالك', labelEn: 'Waste Rate', unit: 'PERCENT', lowerIsBetter: true, supportedStages: 'all', category: 'QUALITY',
    compute: (rows) => {
      const prod = sumField(rows, 'productionTons');
      return prod > 0 ? Number(((sumField(rows, 'wasteTons') / prod) * 100).toFixed(2)) : 0;
    },
  },
  OPERATIONS_COUNT: {
    key: 'OPERATIONS_COUNT', labelAr: 'عدد التشغيلات', labelEn: 'Operations Count', unit: 'COUNT', lowerIsBetter: false, supportedStages: 'all', category: 'PRODUCTION',
    compute: (rows) => rows.length,
  },
  DOWNTIME_MINUTES: {
    key: 'DOWNTIME_MINUTES', labelAr: 'التوقف', labelEn: 'Downtime', unit: 'MINUTES', lowerIsBetter: true, supportedStages: 'all', category: 'DOWNTIME',
    compute: (rows) => sumField(rows, 'totalDowntimeMinutes'),
  },
  EFFICIENCY_RATE: {
    // Reuses the SAME good/production ratio formula already used as "Quality Rate" on the Dashboard - not a new invented formula.
    key: 'EFFICIENCY_RATE', labelAr: 'الكفاءة', labelEn: 'Efficiency', unit: 'PERCENT', lowerIsBetter: false, supportedStages: 'all', category: 'QUALITY',
    compute: (rows) => {
      const prod = sumField(rows, 'productionTons');
      return prod > 0 ? Number(((sumField(rows, 'goodTons') / prod) * 100).toFixed(2)) : 0;
    },
  },
  AVG_PRODUCTION_PER_GROUP: {
    key: 'AVG_PRODUCTION_PER_GROUP', labelAr: 'متوسط الإنتاج لكل عنصر', labelEn: 'Average Production per Entry', unit: 'TONS', lowerIsBetter: false, supportedStages: 'all', category: 'PRODUCTION',
    compute: (rows) => rows.length > 0 ? Number((sumField(rows, 'productionTons') / rows.length).toFixed(3)) : 0,
  },
  MECHANICAL_FAULTS: {
    key: 'MECHANICAL_FAULTS', labelAr: 'أعطال ميكانيكية', labelEn: 'Mechanical Faults', unit: 'MINUTES', lowerIsBetter: true, supportedStages: ['pressing'], category: 'FAULTS',
    compute: (rows) => sumRawField(rows, 'mechanicalFaults'),
  },
  ELECTRICAL_FAULTS: {
    key: 'ELECTRICAL_FAULTS', labelAr: 'أعطال كهربائية', labelEn: 'Electrical Faults', unit: 'MINUTES', lowerIsBetter: true, supportedStages: ['pressing'], category: 'FAULTS',
    compute: (rows) => sumRawField(rows, 'electricalFaults'),
  },
  WORKSHOP_FAULTS: {
    key: 'WORKSHOP_FAULTS', labelAr: 'أعطال ورشة', labelEn: 'Workshop Faults', unit: 'MINUTES', lowerIsBetter: true, supportedStages: ['pressing'], category: 'FAULTS',
    compute: (rows) => sumRawField(rows, 'workshopFaults'),
  },
  RAW_MATERIAL_FAULTS: {
    key: 'RAW_MATERIAL_FAULTS', labelAr: 'أعطال خامات', labelEn: 'Raw Material Faults', unit: 'MINUTES', lowerIsBetter: true, supportedStages: ['pressing'], category: 'FAULTS',
    compute: (rows) => sumRawField(rows, 'rawMaterialFaults'),
  },
  OTHER_FAULTS: {
    key: 'OTHER_FAULTS', labelAr: 'أعطال أخرى', labelEn: 'Other Faults', unit: 'MINUTES', lowerIsBetter: true, supportedStages: ['pressing'], category: 'FAULTS',
    compute: (rows) => sumRawField(rows, 'otherFaults'),
  },
  TOTAL_FAULT_MINUTES: {
    // Sum of the 5 real fault-category fields already stored on Pressing rows - a genuine total, not a new invented number (Part 12/44).
    key: 'TOTAL_FAULT_MINUTES', labelAr: 'إجمالي دقائق الأعطال', labelEn: 'Total Fault Minutes', unit: 'MINUTES', lowerIsBetter: true, supportedStages: ['pressing'], category: 'FAULTS',
    compute: (rows) => sumRawField(rows, 'mechanicalFaults') + sumRawField(rows, 'electricalFaults') + sumRawField(rows, 'workshopFaults') + sumRawField(rows, 'rawMaterialFaults') + sumRawField(rows, 'otherFaults'),
  },
  FAULT_RATE_PER_TON: {
    // Part 7 zero-baseline rule: returns 0 (never a fabricated/misleading value) when production is 0, same convention as WASTE_RATE/EFFICIENCY_RATE above.
    key: 'FAULT_RATE_PER_TON', labelAr: 'معدل الأعطال لكل طن', labelEn: 'Fault Rate per Ton', unit: 'MINUTES', lowerIsBetter: true, supportedStages: ['pressing'], category: 'FAULTS',
    compute: (rows) => {
      const prod = sumField(rows, 'productionTons');
      const faultMinutes = sumRawField(rows, 'mechanicalFaults') + sumRawField(rows, 'electricalFaults') + sumRawField(rows, 'workshopFaults') + sumRawField(rows, 'rawMaterialFaults') + sumRawField(rows, 'otherFaults');
      return prod > 0 ? Number((faultMinutes / prod).toFixed(2)) : 0;
    },
  },
  DOWNTIME_RATE_PER_TON: {
    key: 'DOWNTIME_RATE_PER_TON', labelAr: 'معدل التوقف لكل طن', labelEn: 'Downtime Rate per Ton', unit: 'MINUTES', lowerIsBetter: true, supportedStages: 'all', category: 'DOWNTIME',
    compute: (rows) => {
      const prod = sumField(rows, 'productionTons');
      return prod > 0 ? Number((sumField(rows, 'totalDowntimeMinutes') / prod).toFixed(2)) : 0;
    },
  },
  GAS_CONSUMPTION: {
    // Real field already stored per record (stageRecordService.ts's gasConsumption mapping) - never derived/estimated.
    key: 'GAS_CONSUMPTION', labelAr: 'استهلاك الغاز', labelEn: 'Gas Consumption', unit: 'M3', lowerIsBetter: true, supportedStages: 'all', category: 'EQUIPMENT',
    compute: (rows) => sumField(rows, 'gasConsumption'),
  },
  ELECTRICITY_CONSUMPTION: {
    key: 'ELECTRICITY_CONSUMPTION', labelAr: 'استهلاك الكهرباء', labelEn: 'Electricity Consumption', unit: 'KWH', lowerIsBetter: true, supportedStages: 'all', category: 'EQUIPMENT',
    compute: (rows) => sumField(rows, 'electricityConsumption'),
  },
  LABOR_HOURS: {
    // Sums StageWorkerItem.hours where recorded - a real stored field, never an assumed shift length.
    key: 'LABOR_HOURS', labelAr: 'ساعات العمل', labelEn: 'Labor Hours', unit: 'HOURS', lowerIsBetter: false, supportedStages: 'all', category: 'EMPLOYEES',
    compute: (rows) => rows.reduce((s, r) => s + (r.workers || []).reduce((ws, w) => ws + (Number(w.hours) || 0), 0), 0),
  },
  PRODUCTION_PER_LABOR_HOUR: {
    key: 'PRODUCTION_PER_LABOR_HOUR', labelAr: 'الإنتاج لكل ساعة عمل', labelEn: 'Production per Labor Hour', unit: 'TONS_PER_HOUR', lowerIsBetter: false, supportedStages: 'all', category: 'EMPLOYEES',
    compute: (rows) => {
      const hours = rows.reduce((s, r) => s + (r.workers || []).reduce((ws, w) => ws + (Number(w.hours) || 0), 0), 0);
      return hours > 0 ? Number((sumField(rows, 'productionTons') / hours).toFixed(3)) : 0;
    },
  },
};

export function isMetricSupportedForStage(metric: MetricKey, stage: ProductionStageType | 'all'): boolean {
  const def = METRIC_REGISTRY[metric];
  if (def.supportedStages === 'all') return true;
  if (stage === 'all') return true; // widget spans all stages; per-record filtering still applies where relevant
  return def.supportedStages.includes(stage);
}

export function getMetricLabel(metric: MetricKey, language: 'ar' | 'en'): string {
  return language === 'ar' ? METRIC_REGISTRY[metric].labelAr : METRIC_REGISTRY[metric].labelEn;
}

// Maps a MetricKey onto reportingEngine's RankingMetric where a direct
// equivalent exists, so ranking widgets reuse rankRows() unchanged.
const METRIC_TO_RANKING: Partial<Record<MetricKey, RankingMetric>> = {
  PRODUCTION_TONS: 'productionTons', GOOD_TONS: 'goodTons', WASTE_TONS: 'wasteTons',
  WASTE_RATE: 'wastePercentage', DOWNTIME_MINUTES: 'downtimeMinutes', OPERATIONS_COUNT: 'operationsCount',
};

// ============================================================================
// Entity/Ranking helpers built on top of aggregateByDimension()/rankRows()
// ============================================================================

export function computeRankingForEntity(
  records: UniversalStageRecord[],
  entityType: EntityType,
  metric: MetricKey,
  direction: 'best' | 'worst',
  limit: number,
  language: 'ar' | 'en'
): AggregatedReportRow[] {
  const dimension = ENTITY_TO_DIMENSION[entityType];
  const rows = aggregateByDimension(records, dimension, language);
  const rankingMetric = METRIC_TO_RANKING[metric];
  if (rankingMetric) return rankRows(rows, rankingMetric, direction, limit);
  // Metrics without a direct rankRows equivalent (efficiency, avg-per-group,
  // fault types) are ranked here using the SAME lower-is-better convention.
  const def = METRIC_REGISTRY[metric];
  const scored = rows.map((r) => ({ row: r, value: def.compute(r.records) }));
  const sorted = scored.sort((a, b) => (def.lowerIsBetter ? a.value - b.value : b.value - a.value));
  return (direction === 'best' ? sorted : [...sorted].reverse()).slice(0, limit).map((s) => s.row);
}

// ============================================================================
// Chart Recommendation Engine (§13/14) - a small, explicit rule table, not a
// black box. Returns the recommendation AND a human-readable reason so the
// UI/AI can explain the suggestion, per the "recommend, never force" rule.
// ============================================================================

export interface ChartRecommendation {
  chartType: ChartType;
  reasonAr: string;
  reasonEn: string;
}

export function recommendChartType(
  analysisMode: AnalysisMode,
  opts: { entityCount?: number; metricCount?: number } = {}
): ChartRecommendation {
  const { entityCount = 0, metricCount = 1 } = opts;

  if (analysisMode === 'TREND') {
    return { chartType: 'LINE', reasonAr: 'بيانات زمنية متسلسلة - الخط الزمني الأنسب لإظهار الاتجاه.', reasonEn: 'Time-series data - a line chart best shows the trend.' };
  }
  if (analysisMode === 'PERIOD_COMPARISON') {
    return { chartType: 'GROUPED_BAR', reasonAr: 'مقارنة بين فترتين - الأعمدة المجمعة الأنسب للمقارنة جنبًا إلى جنب.', reasonEn: 'Two-period comparison - grouped bars compare them side by side.' };
  }
  if (analysisMode === 'CROSS_TAB') {
    return { chartType: 'HEATMAP', reasonAr: 'مقارنة بعدين معًا (مثال: الوردية × المعدة) - الخريطة الحرارية الأنسب.', reasonEn: 'Comparing two dimensions together (e.g. shift × equipment) - a heatmap fits best.' };
  }
  if (analysisMode === 'RANKING') {
    if (entityCount > 12) {
      return { chartType: 'TABLE', reasonAr: 'عدد كبير من العناصر - الجدول أوضح من الرسم البياني.', reasonEn: 'A large number of items - a table is clearer than a chart.' };
    }
    return { chartType: 'HORIZONTAL_BAR', reasonAr: 'ترتيب فئات - الأعمدة الأفقية الأنسب لعرض الترتيب.', reasonEn: 'Ranking categories - a horizontal bar best displays the ranking.' };
  }
  if (analysisMode === 'COMPARISON') {
    return { chartType: 'GROUPED_BAR', reasonAr: 'مقارنة بين عناصر محددة - الأعمدة المجمعة الأنسب.', reasonEn: 'Comparing specific entities - grouped bars fit best.' };
  }
  if (analysisMode === 'MULTI_METRIC') {
    if (metricCount >= 3) {
      return { chartType: 'RADAR', reasonAr: 'عدة مقاييس معًا لنفس العنصر - المخطط الراداري يوضح التوازن بينها.', reasonEn: 'Several metrics together for the same entity - a radar chart shows the balance between them.' };
    }
    return { chartType: 'KPI', reasonAr: 'عدد قليل من المقاييس - بطاقات المؤشرات كافية وأوضح.', reasonEn: 'A small number of metrics - KPI cards are clear enough.' };
  }
  // SINGLE_METRIC composition-style default
  if (entityCount > 0 && entityCount <= 6) {
    return { chartType: 'DONUT', reasonAr: 'توزيع/تركيبة قيمة إجمالية على عدد قليل من الفئات.', reasonEn: 'Composition of a total value across a small number of categories.' };
  }
  return { chartType: 'KPI', reasonAr: 'قيمة مفردة - بطاقة مؤشر أداء كافية.', reasonEn: 'A single value - a KPI card is sufficient.' };
}

// ============================================================================
// Time range resolution - turns a TimeRangePreset into concrete start/end
// date strings (YYYY-MM-DD, matching UniversalStageRecord.date), so widgets
// and filterUniversalRecords() share one definition of "this month" etc.
// ============================================================================

/**
 * Formats a Date as YYYY-MM-DD using LOCAL calendar fields, not
 * toISOString()'s UTC conversion - using UTC here would silently roll a
 * locally-constructed midnight (e.g. "the 1st of this month") back to the
 * previous day for any positive-UTC-offset timezone, which is exactly the
 * kind of off-by-one date bug a factory's monthly filters must never have.
 */
function toDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function resolveTimeRangePreset(
  preset: TimeRangePreset,
  customStart?: string,
  customEnd?: string,
  namedMonth?: { year: number; month: number }
): { startDate: string; endDate: string } {
  const now = new Date();
  const todayStr = toDateStr(now);
  const startOfDay = (d: Date) => { const c = new Date(d); c.setHours(0, 0, 0, 0); return c; };

  switch (preset) {
    case 'TODAY':
      return { startDate: todayStr, endDate: todayStr };
    case 'YESTERDAY': {
      const y = new Date(now); y.setDate(y.getDate() - 1);
      return { startDate: toDateStr(y), endDate: toDateStr(y) };
    }
    case 'THIS_WEEK': {
      const start = startOfDay(now); start.setDate(start.getDate() - start.getDay());
      return { startDate: toDateStr(start), endDate: todayStr };
    }
    case 'LAST_WEEK': {
      const end = startOfDay(now); end.setDate(end.getDate() - end.getDay() - 1);
      const start = new Date(end); start.setDate(start.getDate() - 6);
      return { startDate: toDateStr(start), endDate: toDateStr(end) };
    }
    case 'LAST_7_DAYS': {
      const start = new Date(now); start.setDate(start.getDate() - 6);
      return { startDate: toDateStr(start), endDate: todayStr };
    }
    case 'THIS_MONTH': {
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      return { startDate: toDateStr(start), endDate: todayStr };
    }
    case 'LAST_MONTH': {
      const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const end = new Date(now.getFullYear(), now.getMonth(), 0);
      return { startDate: toDateStr(start), endDate: toDateStr(end) };
    }
    case 'LAST_30_DAYS': {
      const start = new Date(now); start.setDate(start.getDate() - 29);
      return { startDate: toDateStr(start), endDate: todayStr };
    }
    case 'LAST_3_MONTHS': {
      const start = new Date(now.getFullYear(), now.getMonth() - 3, now.getDate());
      return { startDate: toDateStr(start), endDate: todayStr };
    }
    case 'LAST_6_MONTHS': {
      const start = new Date(now.getFullYear(), now.getMonth() - 6, now.getDate());
      return { startDate: toDateStr(start), endDate: todayStr };
    }
    case 'THIS_YEAR': {
      const start = new Date(now.getFullYear(), 0, 1);
      return { startDate: toDateStr(start), endDate: todayStr };
    }
    case 'ALL_TIME':
      // Empty bounds - filterUniversalRecords()'s startDate/endDate checks are
      // truthy-gated, so an empty string already means "no bound" with no
      // separate branch needed elsewhere (mirrors DashboardView.tsx's
      // classic-Dashboard 'all' preset - the same convention, not a new one).
      return { startDate: '', endDate: '' };
    case 'NAMED_MONTH': {
      if (namedMonth) {
        const r = resolveNamedMonthRange(namedMonth.year, namedMonth.month);
        return { startDate: r.startDate, endDate: r.endDate };
      }
      return { startDate: customStart || todayStr, endDate: customEnd || todayStr };
    }
    case 'CUSTOM':
    default:
      return { startDate: customStart || todayStr, endDate: customEnd || todayStr };
  }
}

/**
 * Shared filter shape (Part 31 §31 "AnalyticsFilterState") reused by the
 * Dashboard's Live Control Bar and, in principle, by Reports/Statistics -
 * ONE filter vocabulary, not incompatible copies. Each dashboard/report
 * keeps its OWN instance of this state (held in that screen's own React
 * state, never a shared singleton), so editing one dashboard's filters can
 * never bleed into another's (Part 31 §32).
 */
export interface GlobalDashboardFilters {
  timeRangePreset: TimeRangePreset;
  customStart?: string;
  customEnd?: string;
  /** Required when timeRangePreset === 'NAMED_MONTH' - resolved via resolveNamedMonthRange(), the same canonical month resolver the classic Dashboard's setDashboardDateFilter tool already uses. */
  namedMonth?: { year: number; month: number };
  stageType: ProductionStageType | 'all';
  shiftId?: string;
  employeeId?: string;
  pressId?: string;
  productId?: string;
  customerId?: string;
  /**
   * Selected cost-centre hierarchy nodes - the organisational dimension.
   *
   * Replaces the flat legacy press list as the Builder's organisational filter,
   * and is the same field the classic Dashboard uses, so a saved dashboard and
   * the classic screen mean the same thing by it. What a node covers is
   * resolved by the shared resolver, never stored here.
   */
  costCenterNodeIds?: string[];
}

/**
 * Merges a widget's own filters/time-range/stage on top of the dashboard's
 * global ones - local overrides global, 'inherit' follows global (§ Filters:
 * "widgets clearly indicate when a local filter differs from the global
 * one"). Returns both the resolved MultiDimensionFilter-shaped object AND a
 * flag telling the UI whether this widget actually diverges from global.
 */
export function resolveWidgetFilters(
  widget: WidgetConfig,
  global: GlobalDashboardFilters
): { startDate: string; endDate: string; stageType: ProductionStageType | 'all'; filters: WidgetFilters; isOverridden: boolean } {
  const effectivePreset = widget.timeRangePreset === 'inherit' ? global.timeRangePreset : widget.timeRangePreset;
  const { startDate, endDate } = resolveTimeRangePreset(
    effectivePreset,
    widget.filters.startDate || global.customStart,
    widget.filters.endDate || global.customEnd,
    global.namedMonth
  );
  const effectiveStage = widget.productionStage === 'inherit' ? global.stageType : widget.productionStage;
  // Field-level Live Control Bar filters (shift/employee/press/product/
  // customer) apply to every widget unless that widget's OWN local filter
  // already set the same field - local always wins, same principle as
  // time range/stage above (Part 12 §12: "the widget must visibly indicate
  // its local filter").
  const mergedFilters: WidgetFilters = {
    shiftId: widget.filters.shiftId ?? global.shiftId,
    employeeId: widget.filters.employeeId ?? global.employeeId,
    pressId: widget.filters.pressId ?? global.pressId,
    productId: widget.filters.productId ?? global.productId,
    customerId: widget.filters.customerId ?? global.customerId,
  };
  const localFieldOverride = Object.entries(widget.filters).some(([k, v]) => k !== 'startDate' && k !== 'endDate' && k !== 'stageType' && v);
  const isOverridden = widget.timeRangePreset !== 'inherit' || widget.productionStage !== 'inherit' || localFieldOverride;
  return { startDate, endDate, stageType: effectiveStage, filters: mergedFilters, isOverridden };
}

export const TIME_RANGE_LABELS: Record<TimeRangePreset, { ar: string; en: string }> = {
  TODAY: { ar: 'اليوم', en: 'Today' },
  YESTERDAY: { ar: 'أمس', en: 'Yesterday' },
  THIS_WEEK: { ar: 'هذا الأسبوع', en: 'This Week' },
  LAST_WEEK: { ar: 'الأسبوع الماضي', en: 'Last Week' },
  LAST_7_DAYS: { ar: 'آخر 7 أيام', en: 'Last 7 Days' },
  THIS_MONTH: { ar: 'هذا الشهر', en: 'This Month' },
  LAST_MONTH: { ar: 'الشهر الماضي', en: 'Last Month' },
  LAST_30_DAYS: { ar: 'آخر 30 يومًا', en: 'Last 30 Days' },
  LAST_3_MONTHS: { ar: 'آخر 3 أشهر', en: 'Last 3 Months' },
  LAST_6_MONTHS: { ar: 'آخر 6 أشهر', en: 'Last 6 Months' },
  THIS_YEAR: { ar: 'هذا العام', en: 'This Year' },
  ALL_TIME: { ar: 'كل الفترات', en: 'All Time' },
  NAMED_MONTH: { ar: 'شهر محدد', en: 'Named Month' },
  CUSTOM: { ar: 'نطاق مخصص', en: 'Custom Range' },
};

export { ALL_STAGES, getStageDisplayName };

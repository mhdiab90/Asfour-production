/**
 * Extensible, stage-aware Reporting Engine (Part 2).
 *
 * This is the SINGLE shared aggregation layer for both the Reports UI
 * (ReportsView.tsx) and the AI Assistant's report/analysis tools - per the
 * explicit requirement that the assistant must reuse the reporting engine,
 * never build a second one internally.
 *
 * It builds on the EXISTING `fetchUniversalStageRecords()` (stageRecordService.ts),
 * which already normalizes all 8 production stages (pressing + the 7
 * `stage_*` collections) into one `UniversalStageRecord` shape - this module
 * does not duplicate that cross-stage fetch/normalization, only aggregates
 * on top of it.
 *
 * Extensibility model (§9/§44): adding a NEW production stage requires no
 * changes here - as long as `fetchUniversalStageRecords()` maps the new
 * stage's raw fields into `UniversalStageRecord` (productionTons/wasteTons/
 * totalDowntimeMinutes/workers/etc.), every dimension/metric below already
 * understands it. Stage-specific extra metrics (gas/electricity per ton) are
 * already carried on `UniversalStageRecord` and can be added as new metric
 * keys without touching the grouping logic.
 */
import { UniversalStageRecord, ProductionStageType, MultiDimensionFilter } from '../types';
import { STAGE_DISPLAY_NAMES, STAGE_COLLECTION_NAMES } from './stageRecordService';

/** English counterpart to STAGE_DISPLAY_NAMES (stageRecordService.ts), which is Arabic-only. Additive - existing Arabic-only call sites are untouched. */
export const STAGE_DISPLAY_NAMES_EN: Record<ProductionStageType, string> = {
  pressing: 'Pressing',
  rotary_furnace: 'Rotary Furnace',
  chinese_mills: 'Chinese Mills',
  tube_ball_mills: 'Tube / Ball Mills',
  mortar_concrete: 'Mortar & Concrete',
  mixing: 'Mixing',
  lightweight_foam: 'Lightweight Foam',
  sorting: 'Sorting',
};

export function getStageDisplayName(stage: ProductionStageType, language: 'ar' | 'en'): string {
  return language === 'ar' ? STAGE_DISPLAY_NAMES[stage] : STAGE_DISPLAY_NAMES_EN[stage];
}

export const ALL_STAGES: ProductionStageType[] = Object.keys(STAGE_COLLECTION_NAMES) as ProductionStageType[];

export type ReportDimension = 'stage' | 'product' | 'employee' | 'shift' | 'equipment' | 'customer';

export interface AggregatedReportRow {
  key: string;
  label: string;
  operationsCount: number;
  productionTons: number;
  goodTons: number;
  wasteTons: number;
  wastePercentage: number;
  downtimeMinutes: number;
  records: UniversalStageRecord[];
}

/**
 * Report catalog (§10/§22) - each entry declares what it needs; the SAME
 * `aggregateByDimension()` function below serves all of them. Adding a new
 * report category is adding one entry here, not new aggregation code.
 */
export interface ReportCategoryDef {
  id: string;
  nameAr: string;
  nameEn: string;
  descriptionAr: string;
  descriptionEn: string;
  dimension: ReportDimension;
  /** Which UniversalStageRecord field(s) this report primarily reasons about - documentation/UI hint, not enforced. */
  primaryMetric: 'productionTons' | 'wasteTons' | 'downtimeMinutes' | 'wastePercentage';
  supportedStages: ProductionStageType[] | 'all';
}

export const REPORT_CATEGORIES: ReportCategoryDef[] = [
  {
    id: 'production',
    nameAr: 'أداء الإنتاج', nameEn: 'Production Performance',
    descriptionAr: 'إجمالي الإنتاج والإنتاج السليم والهالك مجمعة حسب المنتج.',
    descriptionEn: 'Total, good, and waste production grouped by product.',
    dimension: 'product', primaryMetric: 'productionTons', supportedStages: 'all',
  },
  {
    id: 'employee',
    nameAr: 'أداء الموظفين', nameEn: 'Employee Performance',
    descriptionAr: 'الإنتاج والهالك والتوقف لكل موظف مشارك في التشغيلات.',
    descriptionEn: 'Production, waste, and downtime per employee involved in operations.',
    dimension: 'employee', primaryMetric: 'productionTons', supportedStages: 'all',
  },
  {
    id: 'shift',
    nameAr: 'أداء الورديات', nameEn: 'Shift Performance',
    descriptionAr: 'مقارنة الورديات الثلاث من حيث الإنتاج والهالك والتوقف.',
    descriptionEn: 'Comparing all three shifts by production, waste, and downtime.',
    dimension: 'shift', primaryMetric: 'productionTons', supportedStages: ['pressing'],
  },
  {
    id: 'equipment',
    nameAr: 'أداء المعدات', nameEn: 'Equipment Performance',
    descriptionAr: 'الإنتاج والهالك والتوقف حسب المكبس / الفرن / الآلة.',
    descriptionEn: 'Production, waste, and downtime by press / furnace / machine.',
    dimension: 'equipment', primaryMetric: 'productionTons', supportedStages: 'all',
  },
  {
    id: 'waste',
    nameAr: 'تحليل الهالك', nameEn: 'Waste Analysis',
    descriptionAr: 'نسب وكميات الهالك مجمعة حسب المنتج.',
    descriptionEn: 'Waste quantities and rates grouped by product.',
    dimension: 'product', primaryMetric: 'wasteTons', supportedStages: 'all',
  },
  {
    id: 'downtime',
    nameAr: 'تحليل التوقفات', nameEn: 'Downtime Analysis',
    descriptionAr: 'أوقات التوقف مجمعة حسب المرحلة الإنتاجية.',
    descriptionEn: 'Downtime minutes grouped by production stage.',
    dimension: 'stage', primaryMetric: 'downtimeMinutes', supportedStages: 'all',
  },
  {
    id: 'stageComparison',
    nameAr: 'مقارنة المراحل', nameEn: 'Stage Comparison',
    descriptionAr: 'مقارنة الإنتاج والهالك والتوقف بين كل مراحل التصنيع.',
    descriptionEn: 'Comparing production, waste, and downtime across every manufacturing stage.',
    dimension: 'stage', primaryMetric: 'productionTons', supportedStages: 'all',
  },
];

function extractEquipmentLabel(rec: UniversalStageRecord): { key: string; label: string } {
  const raw = rec.rawData || {};
  const label = raw.pressName || raw.furnaceName || raw.machineName || raw.equipmentName || '';
  const key = raw.pressId || raw.furnaceId || raw.machineId || raw.equipmentId || label;
  return { key: key || 'unknown', label: label || '' };
}

function extractShiftLabel(rec: UniversalStageRecord): { key: string; label: string } {
  const raw = rec.rawData || {};
  return { key: raw.shiftId || raw.shiftCode || 'unknown', label: raw.shiftName || '' };
}

/**
 * Groups already-filtered UniversalStageRecord[] by the requested dimension
 * and computes the shared metric set every report category uses. This is
 * the ONE aggregation function reused by every report + by the AI's
 * `generateReport`/analysis tools (§33).
 */
export function aggregateByDimension(
  records: UniversalStageRecord[],
  dimension: ReportDimension,
  language: 'ar' | 'en'
): AggregatedReportRow[] {
  const map = new Map<string, AggregatedReportRow>();
  const unknownLabel = language === 'ar' ? 'غير محدد' : 'Unspecified';

  const pushRow = (key: string, label: string, rec: UniversalStageRecord) => {
    const finalKey = key || 'unknown';
    if (!map.has(finalKey)) {
      map.set(finalKey, { key: finalKey, label: label || unknownLabel, operationsCount: 0, productionTons: 0, goodTons: 0, wasteTons: 0, wastePercentage: 0, downtimeMinutes: 0, records: [] });
    }
    const row = map.get(finalKey)!;
    row.operationsCount += 1;
    row.productionTons += rec.productionTons || 0;
    row.goodTons += rec.goodTons || 0;
    row.wasteTons += rec.wasteTons || 0;
    row.downtimeMinutes += rec.totalDowntimeMinutes || 0;
    row.records.push(rec);
  };

  for (const rec of records) {
    if (dimension === 'stage') {
      pushRow(rec.stageType, getStageDisplayName(rec.stageType, language), rec);
    } else if (dimension === 'product') {
      pushRow(rec.productId || rec.productName || 'unknown', rec.productName || '', rec);
    } else if (dimension === 'customer') {
      pushRow(rec.customerId || rec.customerName || 'general', rec.customerName || (language === 'ar' ? 'مبيعات عامة' : 'General Sales'), rec);
    } else if (dimension === 'equipment') {
      const { key, label } = extractEquipmentLabel(rec);
      if (label) pushRow(key, label, rec);
    } else if (dimension === 'shift') {
      const { key, label } = extractShiftLabel(rec);
      if (label) pushRow(key, label, rec);
    } else if (dimension === 'employee') {
      if (rec.workers && rec.workers.length > 0) {
        for (const w of rec.workers) {
          if (!w.employeeId && !w.employeeName) continue;
          pushRow(w.employeeId || w.employeeName, w.employeeName || '', rec);
        }
      }
    }
  }

  return Array.from(map.values())
    .map((row) => ({ ...row, wastePercentage: row.productionTons > 0 ? Number(((row.wasteTons / row.productionTons) * 100).toFixed(2)) : 0 }))
    .sort((a, b) => b.productionTons - a.productionTons);
}

/** Ranks aggregated rows by a chosen metric (§19/§21/§41 - "best"/"worst" is never arbitrary, always an explicit metric). */
export type RankingMetric = 'productionTons' | 'goodTons' | 'wasteTons' | 'wastePercentage' | 'downtimeMinutes' | 'operationsCount';

export function rankRows(rows: AggregatedReportRow[], metric: RankingMetric, direction: 'best' | 'worst', limit = 10): AggregatedReportRow[] {
  // For waste/downtime, LOWER is "best" - for production/good-output, HIGHER is "best". Encode that once, here, instead of at every call site.
  const lowerIsBetter = metric === 'wasteTons' || metric === 'wastePercentage' || metric === 'downtimeMinutes';
  const sorted = [...rows].sort((a, b) => (lowerIsBetter ? a[metric] - b[metric] : b[metric] - a[metric]));
  return (direction === 'best' ? sorted : [...sorted].reverse()).slice(0, limit);
}

export function filterUniversalRecords(records: UniversalStageRecord[], filters: MultiDimensionFilter): UniversalStageRecord[] {
  return records.filter((r) => {
    if (filters.startDate && r.date < filters.startDate) return false;
    if (filters.endDate && r.date > filters.endDate) return false;
    if (filters.stageType && filters.stageType !== 'all' && r.stageType !== filters.stageType) return false;
    if (filters.productId && r.productId !== filters.productId) return false;
    if (filters.customerId && r.customerId !== filters.customerId) return false;
    if (filters.employeeId && !r.workers?.some((w) => w.employeeId === filters.employeeId)) return false;
    if (filters.shiftId && (r.rawData?.shiftId || '') !== filters.shiftId) return false;
    if (filters.pressId && (r.rawData?.pressId || '') !== filters.pressId) return false;
    return true;
  });
}

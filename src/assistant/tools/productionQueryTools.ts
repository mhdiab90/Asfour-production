/**
 * Read-only production query tools. These NEVER fabricate numbers - every
 * value returned comes directly from fetchProductionRecords() /
 * calculateKPIsFromRecords() (the same functions the Dashboard/Reports
 * screens already use), just filtered per the tool's arguments.
 */
import { fetchProductionRecords, filterProductionRecords, calculateKPIsFromRecords } from '../../services/productionService';
import { fetchMaterials } from '../../services/materialService';
import { fetchMasterData, MASTER_DATA_COLLECTIONS } from '../../services/masterDataService';
import { ProductionFilter, ProductionRecord } from '../../types';
import { ToolDefinition } from '../types';
import { registerTool } from './registry';
import { PRODUCTION_FILTER_SCHEMA, PRODUCTION_BY_DATE_SCHEMA, NO_PARAMS_SCHEMA } from './parameterSchemas';
import { resolveDateRange, periodDisclosure, ResolvedDateRange } from './dateRangeResolver';

/** Non-date filters only - the date range is always resolved separately via resolveDateRange(). */
export function parseFilterInput(input: any): Omit<ProductionFilter, 'startDate' | 'endDate'> {
  const filter: Omit<ProductionFilter, 'startDate' | 'endDate'> = {};
  if (input?.shiftId) filter.shiftId = String(input.shiftId);
  if (input?.pressId) filter.pressId = String(input.pressId);
  if (input?.furnaceId) filter.furnaceId = String(input.furnaceId);
  if (input?.productId) filter.productId = String(input.productId);
  if (input?.customerId) filter.customerId = String(input.customerId);
  if (input?.employeeId) filter.employeeId = String(input.employeeId);
  return filter;
}

export interface FilteredProductionResult {
  records: ProductionRecord[];
  period: ResolvedDateRange;
}

/**
 * Root-cause fix: this previously left the date range unbounded (all-time)
 * whenever the caller/model omitted startDate/endDate, instead of applying
 * the application's documented "last 30 days" default - so a plain "ما هو
 * إجمالي الإنتاج خلال آخر 30 يوم؟" with no explicit dates silently returned
 * the ENTIRE history instead of the last 30 days. resolveDateRange() is now
 * ALWAYS applied, and every caller must disclose period.wasDefaulted.
 *
 * Scope note: fetchProductionRecords() only reads the Pressing-stage
 * `production` collection (see getProductionSummary's description below,
 * and getProductionByStage/stageReportTools.ts for the all-8-stage total).
 *
 * PHASE 4C: resolveDateRange() always returns a non-empty startDate AND
 * endDate (see dateRangeResolver.ts - it never returns both undefined),
 * so this caller always has a genuine, known-in-advance bounded range
 * BEFORE reading Firestore. That range is now passed straight into
 * fetchProductionRecords() as a server-side bound, instead of downloading
 * the entire Production history and discarding everything outside the
 * period in filterProductionRecords() afterward. filterProductionRecords()
 * is still called with the same filter (including startDate/endDate) as
 * before - its own date check is now a harmless no-op safety net against
 * the already-bounded result, exactly like Phase 4A's stage-record
 * precedent - so every non-date filter (shift/press/product/customer/
 * employee/search) and the returned `period`/`records` shape are
 * unchanged.
 */
export async function fetchFiltered(input: any): Promise<FilteredProductionResult> {
  const period = resolveDateRange(input);
  const all = await fetchProductionRecords({ startDate: period.startDate, endDate: period.endDate });
  const filter: ProductionFilter = { ...parseFilterInput(input), startDate: period.startDate, endDate: period.endDate };
  const records = filterProductionRecords(all, filter);
  return { records, period };
}

export function groupBy(records: ProductionRecord[], keyFn: (r: ProductionRecord) => string | undefined, labelFn: (r: ProductionRecord) => string) {
  const groups = new Map<string, { key: string; label: string; records: ProductionRecord[] }>();
  for (const r of records) {
    const key = keyFn(r);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, { key, label: labelFn(r), records: [] });
    groups.get(key)!.records.push(r);
  }
  return Array.from(groups.values()).map((g) => ({
    key: g.key,
    label: g.label,
    recordCount: g.records.length,
    kpis: calculateKPIsFromRecords(g.records),
  }));
}

/**
 * AI Architecture Consolidation - groupBy() above can't handle employees:
 * a record can list MULTIPLE employeeIds (r.employeeIds), so one record
 * contributes to several groups at once, unlike every other single-valued
 * dimension (shift/press/product). getProductionByEmployee (below) and
 * analysisTools.ts's analyzeEmployeeProduction each carried their own
 * byte-identical copy of this multi-value grouping loop - now shared here.
 */
export function groupByEmployee(records: ProductionRecord[]) {
  const groups = new Map<string, { key: string; label: string; records: ProductionRecord[] }>();
  for (const r of records) {
    const ids = r.employeeIds && r.employeeIds.length > 0 ? r.employeeIds : (r.employeeId ? [r.employeeId] : []);
    ids.forEach((empId, idx) => {
      if (!groups.has(empId)) {
        groups.set(empId, { key: empId, label: r.employeeNames?.[idx] || r.employeeNames?.[0] || empId, records: [] });
      }
      groups.get(empId)!.records.push(r);
    });
  }
  return Array.from(groups.values()).map((g) => ({
    key: g.key,
    label: g.label,
    recordCount: g.records.length,
    kpis: calculateKPIsFromRecords(g.records),
  }));
}

const READ_PERMISSION: (import('../../types/permissions').PermissionKey)[] = ['production.view', 'production.create', 'reports.view'];

function baseQueryTool(
  toolName: string,
  descriptionAr: string,
  descriptionEn: string
): Pick<ToolDefinition, 'toolName' | 'descriptionAr' | 'descriptionEn' | 'commandType' | 'riskLevel' | 'confirmationPolicy' | 'requiredPermission' | 'parameterSchema' | 'inputSchema'> {
  return {
    toolName,
    descriptionAr,
    descriptionEn,
    commandType: 'QUERY',
    riskLevel: 'LOW_RISK',
    confirmationPolicy: 'NONE',
    requiredPermission: READ_PERMISSION,
    parameterSchema: PRODUCTION_FILTER_SCHEMA,
    inputSchema: (input) => ({ valid: true, value: input || {} }),
  };
}

const getProductionSummary: ToolDefinition = {
  ...baseQueryTool(
    'getProductionSummary',
    'ملخص إنتاج مرحلة التشكيل والمكابس فقط (Pressing) بالطن - لا يشمل باقي المراحل الثمانية؛ استخدم getProductionByStage للإجمالي عبر كل المراحل. الفترة الافتراضية آخر 30 يوم إن لم تُحدد.',
    'Pressing-stage production summary ONLY, in tons - does NOT include the other 7 production stages; use getProductionByStage for the whole-factory total across all stages. Defaults to the last 30 days if no period is given.'
  ),
  execute: async (input) => {
    const { records, period } = await fetchFiltered(input);
    const kpis = calculateKPIsFromRecords(records);
    const note = periodDisclosure(period, 'ar');
    const noteEn = periodDisclosure(period, 'en');
    return {
      success: true,
      data: { kpis, recordCount: records.length, period, stageScope: 'pressing' },
      affectedCount: records.length,
      messageAr: `إجمالي إنتاج مرحلة التشكيل والمكابس: ${kpis.totalProductionTons.toFixed(2)} طن عبر ${records.length} سجل${note}.`,
      messageEn: `Total Pressing-stage production: ${kpis.totalProductionTons.toFixed(2)} tons across ${records.length} record(s)${noteEn}.`,
    };
  },
};

const getProductionByDate: ToolDefinition = {
  ...baseQueryTool('getProductionByDate', 'إنتاج يوم محدد (YYYY-MM-DD)', 'Production for a specific date (YYYY-MM-DD)'),
  parameterSchema: PRODUCTION_BY_DATE_SCHEMA,
  inputSchema: (input) => {
    const date = String(input?.date || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { valid: false, errors: ['date must be in YYYY-MM-DD format'] };
    return { valid: true, value: { date } };
  },
  execute: async (input) => {
    const { records } = await fetchFiltered(input);
    const kpis = calculateKPIsFromRecords(records);
    return {
      success: true,
      data: { date: input.date, kpis, recordCount: records.length, stageScope: 'pressing' },
      affectedCount: records.length,
      messageAr: `إنتاج يوم ${input.date} (مرحلة التشكيل والمكابس): ${kpis.totalProductionTons.toFixed(2)} طن عبر ${records.length} سجل.`,
      messageEn: `Pressing-stage production on ${input.date}: ${kpis.totalProductionTons.toFixed(2)} tons across ${records.length} record(s).`,
    };
  },
};

const getProductionByShift: ToolDefinition = {
  ...baseQueryTool('getProductionByShift', 'تفصيل الإنتاج حسب الوردية', 'Production breakdown by shift'),
  execute: async (input) => {
    const { records, period } = await fetchFiltered(input);
    const groups = groupBy(records, (r) => r.shiftId, (r) => r.shiftName);
    return {
      success: true,
      data: { groups, period, stageScope: 'pressing' },
      affectedCount: records.length,
      messageAr: `تم تفصيل ${records.length} سجل عبر ${groups.length} وردية${periodDisclosure(period, 'ar')}.`,
      messageEn: `Broke down ${records.length} record(s) across ${groups.length} shift(s)${periodDisclosure(period, 'en')}.`,
    };
  },
};

const getProductionByPress: ToolDefinition = {
  ...baseQueryTool('getProductionByPress', 'تفصيل الإنتاج حسب المكبس', 'Production breakdown by press'),
  execute: async (input) => {
    const { records, period } = await fetchFiltered(input);
    const groups = groupBy(records, (r) => r.pressId, (r) => r.pressName);
    return {
      success: true,
      data: { groups, period, stageScope: 'pressing' },
      affectedCount: records.length,
      messageAr: `تم تفصيل ${records.length} سجل عبر ${groups.length} مكبس${periodDisclosure(period, 'ar')}.`,
      messageEn: `Broke down ${records.length} record(s) across ${groups.length} press(es)${periodDisclosure(period, 'en')}.`,
    };
  },
};

const getProductionByEmployee: ToolDefinition = {
  ...baseQueryTool('getProductionByEmployee', 'تفصيل الإنتاج حسب الموظف', 'Production breakdown by employee'),
  execute: async (input) => {
    const { records, period } = await fetchFiltered(input);
    const result = groupByEmployee(records);
    return {
      success: true,
      data: { groups: result, period, stageScope: 'pressing' },
      affectedCount: records.length,
      messageAr: `تم تفصيل ${records.length} سجل عبر ${result.length} موظف${periodDisclosure(period, 'ar')}.`,
      messageEn: `Broke down ${records.length} record(s) across ${result.length} employee(s)${periodDisclosure(period, 'en')}.`,
    };
  },
};

const getWasteSummary: ToolDefinition = {
  ...baseQueryTool('getWasteSummary', 'ملخص الهالك/التالف', 'Waste/scrap summary'),
  execute: async (input) => {
    const { records, period } = await fetchFiltered(input);
    const kpis = calculateKPIsFromRecords(records);
    return {
      success: true,
      data: {
        totalWasteTons: kpis.totalWasteTons,
        wastePercentage: kpis.wastePercentage,
        totalWasteWeightKg: kpis.totalWasteWeightKg,
        recordCount: records.length,
        period,
        stageScope: 'pressing',
      },
      affectedCount: records.length,
      messageAr: `إجمالي الهالك: ${kpis.totalWasteTons.toFixed(2)} طن (${kpis.wastePercentage.toFixed(1)}%)${periodDisclosure(period, 'ar')}.`,
      messageEn: `Total waste: ${kpis.totalWasteTons.toFixed(2)} tons (${kpis.wastePercentage.toFixed(1)}%)${periodDisclosure(period, 'en')}.`,
    };
  },
};

const getDowntimeSummary: ToolDefinition = {
  ...baseQueryTool('getDowntimeSummary', 'ملخص وقت التوقف', 'Downtime summary'),
  execute: async (input) => {
    const { records, period } = await fetchFiltered(input);
    const kpis = calculateKPIsFromRecords(records);
    return {
      success: true,
      data: { totalDowntimeMinutes: kpis.totalDowntimeMinutes, totalDowntimeHours: kpis.totalDowntimeHours, recordCount: records.length, period, stageScope: 'pressing' },
      affectedCount: records.length,
      messageAr: `إجمالي وقت التوقف: ${kpis.totalDowntimeHours.toFixed(1)} ساعة (${kpis.totalDowntimeMinutes.toFixed(0)} دقيقة)${periodDisclosure(period, 'ar')}.`,
      messageEn: `Total downtime: ${kpis.totalDowntimeHours.toFixed(1)} hours (${kpis.totalDowntimeMinutes.toFixed(0)} minutes)${periodDisclosure(period, 'en')}.`,
    };
  },
};

const getFaultSummary: ToolDefinition = {
  ...baseQueryTool('getFaultSummary', 'ملخص الأعطال حسب النوع', 'Fault summary by category'),
  execute: async (input) => {
    const { records, period } = await fetchFiltered(input);
    const totals = {
      mechanicalFaults: 0,
      electricalFaults: 0,
      workshopFaults: 0,
      rawMaterialFaults: 0,
      furnaceFaults: 0,
      pressFaults: 0,
      otherFaults: 0,
    };
    for (const r of records) {
      totals.mechanicalFaults += Number(r.mechanicalFaults || 0);
      totals.electricalFaults += Number(r.electricalFaults || 0);
      totals.workshopFaults += Number(r.workshopFaults || 0);
      totals.rawMaterialFaults += Number(r.rawMaterialFaults || 0);
      totals.furnaceFaults += Number(r.furnaceFaults || 0);
      totals.pressFaults += Number(r.pressFaults || 0);
      totals.otherFaults += Number(r.otherFaults || 0);
    }
    const totalMinutes = Object.values(totals).reduce((a, b) => a + b, 0);
    return {
      success: true,
      data: { totals, totalMinutes, recordCount: records.length, period, stageScope: 'pressing' },
      affectedCount: records.length,
      messageAr: `إجمالي دقائق الأعطال: ${totalMinutes.toFixed(0)} دقيقة عبر ${records.length} سجل${periodDisclosure(period, 'ar')}.`,
      messageEn: `Total fault minutes: ${totalMinutes.toFixed(0)} across ${records.length} record(s)${periodDisclosure(period, 'en')}.`,
    };
  },
};

const getMaterialUsage: ToolDefinition = {
  ...baseQueryTool('getMaterialUsage', 'المخزون الحالي للمواد الخام (لا يوجد ربط مباشر باستهلاك الإنتاج في النموذج الحالي)', 'Current raw material inventory levels (production records do not track per-run material consumption in the current data model)'),
  parameterSchema: NO_PARAMS_SCHEMA,
  execute: async () => {
    const materials = await fetchMaterials();
    return {
      success: true,
      data: { materials },
      affectedCount: materials.length,
      messageAr: `يوجد ${materials.length} مادة خام مسجلة. ملاحظة: هذا مستوى المخزون الحالي فقط، ولا يوجد ربط مباشر بسجلات الإنتاج بعد.`,
      messageEn: `${materials.length} raw material(s) registered. Note: this is the current inventory snapshot only - production records do not yet link to per-run material consumption.`,
    };
  },
};

const getMasterDataSummary: ToolDefinition = {
  ...baseQueryTool('getMasterDataSummary', 'ملخص عدد عناصر كل بيانات أساسية', 'Count of items per master data domain'),
  requiredPermission: ['masterdata.view'],
  parameterSchema: NO_PARAMS_SCHEMA,
  execute: async () => {
    const domains = Object.keys(MASTER_DATA_COLLECTIONS) as Array<keyof typeof MASTER_DATA_COLLECTIONS>;
    const counts: Record<string, number> = {};
    for (const domain of domains) {
      const items = await fetchMasterData<any>(MASTER_DATA_COLLECTIONS[domain]);
      counts[domain] = items.length;
    }
    return {
      success: true,
      data: { counts },
      messageAr: `ملخص البيانات الأساسية: ${Object.entries(counts).map(([k, v]) => `${k}=${v}`).join('، ')}.`,
      messageEn: `Master data summary: ${Object.entries(counts).map(([k, v]) => `${k}=${v}`).join(', ')}.`,
    };
  },
};

export function registerProductionQueryTools(): void {
  [
    getProductionSummary,
    getProductionByDate,
    getProductionByShift,
    getProductionByPress,
    getProductionByEmployee,
    getWasteSummary,
    getDowntimeSummary,
    getFaultSummary,
    getMaterialUsage,
    getMasterDataSummary,
  ].forEach(registerTool);
}

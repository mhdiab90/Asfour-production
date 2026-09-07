/**
 * Shared JSON Schema fragments (Anthropic tool-use `input_schema` format)
 * for the ToolDefinition.parameterSchema field. These are advisory metadata
 * sent to a real AIProvider so it knows what arguments a tool accepts -
 * every tool's own inputSchema() validator (see each tools/*.ts file) is
 * still the sole source of truth for what actually executes.
 */

export const NO_PARAMS_SCHEMA = {
  type: 'object',
  properties: {},
  required: [],
};

/**
 * Shared by every production-record query/analysis tool (fetchFiltered()-based).
 * IMPORTANT: never compute or guess startDate/endDate yourself for relative
 * phrases like "last 30 days", "this month", or "today" - omit both fields
 * entirely and the tool will apply the application's own definition
 * (defaulting to the last 30 days, always disclosed in the response).
 */
export const PRODUCTION_FILTER_SCHEMA = {
  type: 'object',
  properties: {
    startDate: { type: 'string', description: 'ISO date YYYY-MM-DD, inclusive start of the range. Omit for "last 30 days" or any unspecified period - do not compute this yourself.' },
    endDate: { type: 'string', description: 'ISO date YYYY-MM-DD, inclusive end of the range. Omit along with startDate to use the default (last 30 days).' },
    date: { type: 'string', description: 'ISO date YYYY-MM-DD for a single specific day (overrides startDate/endDate) - only for an explicit single-day question like "today" or "yesterday".' },
    shiftId: { type: 'string', description: 'Filter to one shift by id' },
    pressId: { type: 'string', description: 'Filter to one press by id' },
    furnaceId: { type: 'string', description: 'Filter to one furnace by id' },
    productId: { type: 'string', description: 'Filter to one product by id' },
    customerId: { type: 'string', description: 'Filter to one customer by id' },
    employeeId: { type: 'string', description: 'Filter to one employee by id' },
  },
  required: [],
};

export const PRODUCTION_BY_DATE_SCHEMA = {
  type: 'object',
  properties: {
    date: { type: 'string', description: 'ISO date YYYY-MM-DD (required)' },
  },
  required: ['date'],
};

/** Shared by cross-stage ranking tools (getTopEmployees/getTopShifts/getTopPresses/getTopProducts). */
export const RANKING_SCHEMA = {
  type: 'object',
  properties: {
    direction: { type: 'string', enum: ['best', 'worst'], description: 'Rank direction; defaults to "best" if omitted' },
    metric: {
      type: 'string',
      enum: ['productionTons', 'goodTons', 'wasteTons', 'wastePercentage', 'downtimeMinutes', 'operationsCount'],
      description: 'Ranking metric; defaults to "goodTons" (Good Production) if omitted - this default MUST be disclosed in the response',
    },
    startDate: { type: 'string', description: 'ISO date YYYY-MM-DD; if omitted along with endDate, defaults to the last 30 days (MUST be disclosed)' },
    endDate: { type: 'string', description: 'ISO date YYYY-MM-DD' },
    limit: { type: 'number', description: 'Max rows to return; defaults to 5' },
    stageType: {
      type: 'string',
      description: 'Optional single production stage id to restrict to (e.g. "pressing", "chinese_mills", "rotary_furnace")',
    },
  },
  required: [],
};

export const PRODUCTION_BY_STAGE_SCHEMA = {
  type: 'object',
  properties: {
    startDate: { type: 'string', description: 'ISO date YYYY-MM-DD; defaults to last 30 days if omitted (MUST be disclosed)' },
    endDate: { type: 'string', description: 'ISO date YYYY-MM-DD' },
  },
  required: [],
};

export const COMPARE_STAGES_SCHEMA = {
  type: 'object',
  properties: {
    stages: {
      type: 'array',
      items: { type: 'string' },
      description: 'At least 2 production stage ids to compare, e.g. ["pressing","chinese_mills"]',
      minItems: 2,
    },
    startDate: { type: 'string', description: 'ISO date YYYY-MM-DD; defaults to last 30 days if omitted' },
    endDate: { type: 'string', description: 'ISO date YYYY-MM-DD' },
  },
  required: ['stages'],
};

/** comparePeriods (Phase 3 §20/§21/§24/§34) - both periods require EXPLICIT dates; the model must compute them itself for named periods (e.g. "May 2026" -> 2026-05-01/2026-05-31), never leave one defaulted, since comparing an explicit period against an implicit "last 30 days" default would be misleading. */
export const COMPARE_PERIODS_SCHEMA = {
  type: 'object',
  properties: {
    periodA: {
      type: 'object',
      properties: {
        startDate: { type: 'string', description: 'ISO date YYYY-MM-DD - required, always explicit' },
        endDate: { type: 'string', description: 'ISO date YYYY-MM-DD - required, always explicit (use the TRUE last day of the month, e.g. 30 for June, never assume 30/31)' },
        label: { type: 'string', description: 'Optional short label for this period, e.g. "May 2026"' },
      },
      required: ['startDate', 'endDate'],
      description: 'First period to compare',
    },
    periodB: {
      type: 'object',
      properties: {
        startDate: { type: 'string', description: 'ISO date YYYY-MM-DD - required, always explicit' },
        endDate: { type: 'string', description: 'ISO date YYYY-MM-DD - required, always explicit' },
        label: { type: 'string', description: 'Optional short label for this period, e.g. "June 2026"' },
      },
      required: ['startDate', 'endDate'],
      description: 'Second period to compare',
    },
    stageType: { type: 'string', description: 'Optional single production stage id to restrict BOTH periods to; omit for factory-wide (all 8 stages)' },
    metric: {
      type: 'string',
      enum: ['productionTons', 'goodTons', 'wasteTons', 'wastePercentage', 'downtimeMinutes'],
      description: 'Primary metric to compare; defaults to productionTons if omitted',
    },
  },
  required: ['periodA', 'periodB'],
};

export const GENERATE_REPORT_SCHEMA = {
  type: 'object',
  properties: {
    categoryId: { type: 'string', description: 'Report category id from the existing report catalog (e.g. "production", "waste", "downtime")' },
    startDate: { type: 'string', description: 'ISO date YYYY-MM-DD; defaults to last 30 days if omitted' },
    endDate: { type: 'string', description: 'ISO date YYYY-MM-DD' },
    stageType: { type: 'string', description: 'Optional single production stage id to restrict to' },
  },
  required: ['categoryId'],
};

export const EXPORT_REPORT_SCHEMA = {
  type: 'object',
  properties: {
    reportType: { type: 'string', enum: ['production', 'waste', 'downtime', 'faults'], description: 'Which report to build and export; defaults to "production"' },
    startDate: { type: 'string', description: 'ISO date YYYY-MM-DD' },
    endDate: { type: 'string', description: 'ISO date YYYY-MM-DD' },
  },
  required: [],
};

/** Master data search/list/duplicate-check tools. */
export const MASTER_DATA_DOMAIN_QUERY_SCHEMA = {
  type: 'object',
  properties: {
    domain: {
      type: 'string',
      description: 'Master data domain key, e.g. "furnaceCars", "presses", "shifts", "employees", "products", "customers"',
    },
    query: { type: 'string', description: 'Optional free-text search term (matches code/name/carNumber)' },
  },
  required: ['domain'],
};

export const CHECK_DUPLICATE_SCHEMA = {
  type: 'object',
  properties: {
    domain: { type: 'string', description: 'Master data domain key' },
    code: { type: 'string', description: 'Business code to check for an existing match' },
  },
  required: ['domain', 'code'],
};

/** Generic addMasterData tool. */
export const ADD_MASTER_DATA_SCHEMA = {
  type: 'object',
  properties: {
    domain: { type: 'string', description: 'Master data domain key, e.g. "furnaceCars", "presses", "shifts", "employees", "products", "customers"' },
    codes: { type: 'array', items: { type: 'string' }, description: 'One or more business codes to create' },
  },
  required: ['domain', 'codes'],
};

/** addFurnaceCars: accepts either car+brick pairs, a codes[] array, or a raw string of codes. */
export const ADD_FURNACE_CARS_SCHEMA = {
  type: 'object',
  properties: {
    pairs: {
      type: 'array',
      description: 'Structured furnace car + brick count pairs, when the user specified a brick count per car',
      items: {
        type: 'object',
        properties: {
          carNumber: { type: 'string' },
          brickCount: { type: 'number' },
        },
        required: ['carNumber'],
      },
    },
    codes: { type: 'array', items: { type: 'string' }, description: 'Furnace car numbers to add, when no brick count was given' },
  },
  required: [],
};

export const ADD_PRESSES_SCHEMA = {
  type: 'object',
  properties: {
    codes: { type: 'array', items: { type: 'string' }, description: 'One or more press codes (each is a single atomic value, never split)' },
  },
  required: ['codes'],
};

export const ADD_SHIFTS_SCHEMA = {
  type: 'object',
  properties: {
    codes: { type: 'array', items: { type: 'string' }, description: 'One or more shift codes/names' },
  },
  required: ['codes'],
};

/** addEmployees/addCustomers: name required, code optional (defaults to name - never invent a business code). */
export const ADD_NAMED_ENTITY_SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Full name - required' },
          code: { type: 'string', description: 'Optional explicit business code; if omitted, the name is used as the identifying value - never invent a code' },
        },
        required: ['name'],
      },
    },
  },
  required: ['items'],
};

export const ADD_PRODUCTS_SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          code: { type: 'string', description: 'Product code - required, treated as one atomic value, never split' },
          name: { type: 'string', description: 'Optional display name; defaults to the code' },
        },
        required: ['code'],
      },
    },
  },
  required: ['items'],
};

export const NAVIGATE_TO_PAGE_SCHEMA = {
  type: 'object',
  properties: {
    page: { type: 'string', description: 'Target screen id, e.g. "dashboard", "production-entry", "reports", "master-data", "historical-import"' },
  },
  required: ['page'],
};

export const PROPOSE_DASHBOARD_WIDGETS_SCHEMA = {
  type: 'object',
  properties: {
    query: { type: 'string', description: "The user's natural-language dashboard request, e.g. \"best and worst press and employee\"" },
  },
  required: ['query'],
};

/** openReportView (Phase 4) - navigates to the Reports screen with a report category/stage/date pre-applied, reusing the SAME session-local handoff already used by the Dashboard Builder's "Open full report" action. */
export const OPEN_REPORT_VIEW_SCHEMA = {
  type: 'object',
  properties: {
    categoryId: {
      type: 'string',
      enum: ['production', 'employee', 'shift', 'equipment', 'waste', 'downtime', 'stageComparison'],
      description: 'Which report category to open; omit to keep the Reports screen\'s current/default category ("production" if none was open yet).',
    },
    stageType: {
      type: 'string',
      description: 'Optional single production stage id to filter to, e.g. "pressing", "rotary_furnace", "chinese_mills", "tube_ball_mills", "mortar_concrete", "mixing", "lightweight_foam", "sorting" - map colloquial names ("المكابس", "أفران دوارة") to these exact ids. Omit for all stages.',
    },
    startDate: { type: 'string', description: 'ISO date YYYY-MM-DD; if omitted along with endDate, the Reports screen keeps its current date range' },
    endDate: { type: 'string', description: 'ISO date YYYY-MM-DD' },
  },
  required: [],
};

/**
 * Dashboard Capability Upgrade - the Dashboard now has REAL date/stage/shift/
 * entity/sort filters (see DashboardView.tsx), each with its own scoped
 * tool/schema below. Furnace-car filtering is deliberately NOT included:
 * reportingEngine.ts's filterUniversalRecords()/MultiDimensionFilter has no
 * furnace-car dimension - it is a Rotary-Furnace-stage-specific raw field,
 * not a universal one, so no setDashboardFurnaceCarFilter tool exists.
 */
export const SET_DASHBOARD_DATE_FILTER_SCHEMA = {
  type: 'object',
  properties: {
    preset: {
      type: 'string',
      enum: ['today', 'week', 'month', 'last30days', 'all', 'custom', 'namedMonth'],
      description: '"today", "week" (last 7 days), "month" (this calendar month, 1st-to-date - the Dashboard default), "last30days" (rolling 30-day window), "all" (no date bound), "custom" (requires startDate+endDate), "namedMonth" (requires month+year, e.g. "مايو 2026" -> month:5, year:2026).',
    },
    startDate: { type: 'string', description: 'ISO date YYYY-MM-DD - required when preset="custom"' },
    endDate: { type: 'string', description: 'ISO date YYYY-MM-DD - required when preset="custom"' },
    month: { type: 'number', description: '1-12 - required when preset="namedMonth"' },
    year: { type: 'number', description: '4-digit year - required when preset="namedMonth"' },
  },
  required: ['preset'],
};

export const SET_DASHBOARD_STAGE_FILTER_SCHEMA = {
  type: 'object',
  properties: {
    stageType: {
      type: 'string',
      description: 'One of the 8 production stage ids (e.g. "pressing", "chinese_mills", "rotary_furnace") or "all" to clear the stage filter.',
    },
  },
  required: ['stageType'],
};

export const SET_DASHBOARD_SHIFT_FILTER_SCHEMA = {
  type: 'object',
  properties: {
    shift: { type: 'string', description: 'Shift name or code to filter to, e.g. "الوردية الأولى". Omit or pass an empty string to clear the shift filter.' },
  },
  required: [],
};

export const SET_DASHBOARD_ENTITY_FILTER_SCHEMA = {
  type: 'object',
  properties: {
    entityType: { type: 'string', enum: ['press', 'employee', 'customer', 'product'], description: 'Which entity dimension to filter the Dashboard by.' },
    value: { type: 'string', description: 'Name or code identifying the entity, e.g. "2000" for a press, "شركة النور" for a customer. Omit or pass an empty string to clear that entity filter.' },
  },
  required: ['entityType'],
};

export const SET_DASHBOARD_SORT_SCHEMA = {
  type: 'object',
  properties: {
    field: {
      type: 'string',
      enum: ['productionTons', 'goodTons', 'wasteTons', 'wastePercentage', 'downtimeMinutes', 'operationsCount'],
      description: 'Which metric to sort the Dashboard\'s equipment distribution table by.',
    },
    direction: { type: 'string', enum: ['best', 'worst'], description: 'Sort direction; defaults to "best" if omitted.' },
  },
  required: ['field'],
};

/**
 * Phase 4B - "استخدم اللوحة رقم 1" / "افتح اللوحة رقم 1" / "عدل لوحة
 * الإنتاج". Omit both fields to LIST the user's saved custom dashboards
 * instead of opening one (discovery). dashboardNumber is the stable "لوحة
 * N" number every saved dashboard has - never guess it, never invent a
 * dashboardId (that's an internal opaque string the model never sees).
 */
export const USE_CUSTOM_DASHBOARD_SCHEMA = {
  type: 'object',
  properties: {
    dashboardNumber: { type: 'number', description: 'The dashboard\'s number, e.g. "اللوحة رقم 1" -> 1. Omit along with dashboardName to list all saved dashboards instead of opening one.' },
    dashboardName: { type: 'string', description: 'The dashboard\'s name or a distinctive part of it, e.g. "لوحة الإنتاج الشهرية". Only used when dashboardNumber is not given.' },
  },
  required: [],
};

/**
 * Phase 4B Part 3/§5-6 - edits the CURRENTLY OPEN custom dashboard's
 * temporary (unsaved) filters - the SAME GlobalDashboardFilters shape the
 * Live Control Bar itself uses. This is view-only state until the user
 * explicitly asks to save (saveCustomDashboardChanges) - never silently
 * persisted. Requires a custom dashboard to already be open (useCustomDashboard first).
 */
export const SET_CUSTOM_DASHBOARD_FILTERS_SCHEMA = {
  type: 'object',
  properties: {
    timeRangePreset: { type: 'string', enum: ['TODAY', 'YESTERDAY', 'THIS_WEEK', 'LAST_WEEK', 'LAST_7_DAYS', 'THIS_MONTH', 'LAST_MONTH', 'LAST_30_DAYS', 'LAST_3_MONTHS', 'LAST_6_MONTHS', 'THIS_YEAR', 'ALL_TIME', 'NAMED_MONTH', 'CUSTOM'], description: 'Real presets from the Dashboard Builder\'s own time-range vocabulary - never invent a value outside this list.' },
    startDate: { type: 'string', description: 'ISO date YYYY-MM-DD - required when timeRangePreset="CUSTOM". Must not be after endDate.' },
    endDate: { type: 'string', description: 'ISO date YYYY-MM-DD - required when timeRangePreset="CUSTOM". Must not be before startDate.' },
    month: { type: 'number', description: 'Month number 1-12 - required when timeRangePreset="NAMED_MONTH".' },
    year: { type: 'number', description: 'Four-digit year - required when timeRangePreset="NAMED_MONTH".' },
    stageType: { type: 'string', description: 'One of the 8 production stage ids, or "all" to clear the stage filter.' },
    shift: { type: 'string', description: 'Shift name/code to filter to, e.g. "الوردية الثانية"/"shift 2". Omit to leave unchanged; pass an empty string to clear.' },
    employee: { type: 'string', description: 'Employee name to filter to. Omit to leave unchanged; pass an empty string to clear.' },
    press: { type: 'string', description: 'Press/equipment name to filter to. Omit to leave unchanged; pass an empty string to clear.' },
    product: { type: 'string', description: 'Product name to filter to. Omit to leave unchanged; pass an empty string to clear.' },
    customer: { type: 'string', description: 'Customer name to filter to. Omit to leave unchanged; pass an empty string to clear.' },
  },
  required: [],
};

/**
 * Phase 4B Part 4 §7-13 - changes ONE widget's chart type and/or ranking
 * direction on the currently open dashboard. Omit `chartType` to get an
 * interactive chart-type choice back instead of applying anything (§11 -
 * recommendation/options are never auto-applied). Omit both widgetId and
 * widgetLabel to resolve against the currently UI-selected widget, or (if
 * the dashboard has exactly one widget) that widget - an ambiguous/missing
 * target returns an interactive "which chart?" choice instead of guessing.
 */
export const SET_CUSTOM_DASHBOARD_WIDGET_SCHEMA = {
  type: 'object',
  properties: {
    widgetId: { type: 'string', description: 'Internal widget id, only ever used when echoing back a value this tool itself returned earlier (e.g. a candidate id) - never invent one.' },
    widgetLabel: { type: 'string', description: 'The widget\'s visible title/metric name as the user referred to it, e.g. "الهالك"/"waste". Omit to use the currently selected widget.' },
    chartType: { type: 'string', enum: ['BAR', 'HORIZONTAL_BAR', 'GROUPED_BAR', 'STACKED_BAR', 'LINE', 'MULTI_LINE', 'AREA', 'STACKED_AREA', 'PIE', 'DONUT', 'SCATTER', 'HEATMAP', 'RADAR', 'COMBO', 'TABLE', 'KPI', 'RANKING_LIST'], description: 'The new chart type. Omit this field entirely (do not guess) when the user did not name a specific type ("غير شكل الرسم" alone) - the tool will return the real allowed options as an interactive choice instead.' },
    rankingDirection: { type: 'string', enum: ['best', 'worst'], description: 'New ranking/sort direction for this widget (only meaningful for RANKING/COMPARISON widgets).' },
  },
  required: [],
};

/** Phase 4B Part 5 §15-19 - creates a NEW custom dashboard from a natural-language description (reuses the SAME proposeDashboardConfig() the existing AI Report Designer panel uses) or blank if no description is given. Always requires the user's explicit confirmation before persisting (confirmationPolicy ALWAYS) - this only ever returns/persists a DRAFT, never arbitrary widget JSON the user didn't see. */
export const CREATE_CUSTOM_DASHBOARD_SCHEMA = {
  type: 'object',
  properties: {
    name: { type: 'string', description: 'Dashboard name. If omitted, a reasonable default is generated from the description or dashboard number.' },
    dashboardNumber: { type: 'number', description: 'Explicit requested number, e.g. "لوحة رقم 5" -> 5. If that number is already taken, the tool reports it and does NOT overwrite - it never reuses an existing number.' },
    description: { type: 'string', description: 'Natural-language description of the desired widgets/content, e.g. "للإنتاج الشهري" or "أفضل 5 موظفين والهالك والتوقفات". Omit for a blank starter dashboard.' },
  },
  required: [],
};

/** Phase 4B Part 5-6 §6/§10-11 - persists the CURRENTLY OPEN dashboard's on-screen state (including any temporary filter/widget edits applied via the tools above) as its real saved configuration. Always requires explicit confirmation (confirmationPolicy ALWAYS) - a temporary view change is NEVER auto-persisted. */
export const SAVE_CUSTOM_DASHBOARD_CHANGES_SCHEMA = {
  type: 'object',
  properties: {
    asDefaultFilters: { type: 'boolean', description: 'true = also save the CURRENT temporary filters as this dashboard\'s persisted default (e.g. "خليها افتراضيًا على مايو 2026"). false/omitted = save only the layout/widget changes, leaving the dashboard\'s default filters as they were.' },
  },
  required: [],
};

/** openMasterDataRecord (Phase 4 completion) - "افتح المكبس 2000" / "افتح العربة 209" / "افتح العميل شركة النور". Reuses the SAME lookup searchMasterData already uses, then navigates + highlights, never auto-opens the edit modal. */
export const OPEN_MASTER_DATA_RECORD_SCHEMA = {
  type: 'object',
  properties: {
    domain: {
      type: 'string',
      description: 'Master data domain key, e.g. "furnaceCars", "presses", "shifts", "employees", "products", "customers" - same domain keys searchMasterData uses.',
    },
    query: { type: 'string', description: 'The name/code/car-number identifying the record to open, e.g. "2000", "209", "شركة النور", or a ranked name resolved from a prior tool result in this conversation (e.g. the #1 name from a getTopEmployees ranking).' },
  },
  required: ['domain', 'query'],
};

/**
 * Phase 6 §6.1-§6.9 - the ONE business-intelligence tool: mode="summary"
 * produces an executive summary (key metrics/changes/strengths/weaknesses/
 * risks/recommendations), mode="alerts" produces deterministic,
 * threshold-based anomaly indications. Both reuse the exact same
 * reportingEngine.ts aggregation every other analytics tool uses - never a
 * second numbers engine, never an LLM-invented figure.
 */
export const GENERATE_BUSINESS_INSIGHTS_SCHEMA = {
  type: "object",
  properties: {
    mode: { type: "string", enum: ["summary", "alerts"], description: "'summary' for an executive/management summary; 'alerts' for anomaly/threshold indications." },
    startDate: { type: "string", description: "ISO date YYYY-MM-DD; omit along with endDate for the default (last 30 days, disclosed)." },
    endDate: { type: "string", description: "ISO date YYYY-MM-DD" },
    stageType: { type: "string", description: "Optional single production stage id to restrict to; omit for factory-wide (all 8 stages)." },
  },
  required: ["mode"],
};

/** Universal Data Intelligence pass - explains what CAN be derived from current data; never invents a metric outside the registered catalog. */
export const GET_SUGGESTED_ANALYTICS_SCHEMA = {
  type: "object",
  properties: {
    category: { type: "string", enum: ["PRODUCTION", "QUALITY", "DOWNTIME", "FAULTS", "EMPLOYEES", "EQUIPMENT", "SHIFTS", "PRODUCTS", "CUSTOMERS", "STAGES", "ACCOUNTING", "DATA_QUALITY"], description: "Optional single category to filter to; omit for a cross-category summary of top suggestions." },
    stageType: { type: "string", description: "Optional single production stage id to restrict to; omit for factory-wide." },
  },
  required: [],
};

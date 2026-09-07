/**
 * AI Report Designer (§22-24, and Part 9 §35-40 of the Power BI-style task)
 * - turns a natural-language Arabic/English request into a STRUCTURED
 * dashboard/report proposal (DashboardSection[] of WidgetConfig, both drawn
 * straight from dashboardRegistry.ts) - never arbitrary code, never a
 * direct Firestore write. Follows the same keyword/pattern-classification
 * approach as assistant/providers/MockProvider.ts, the one AI approach this
 * codebase has a real, secure, working implementation of.
 *
 * Every proposed widget is a real, valid WidgetConfig the Dashboard Builder
 * can render, edit, or discard exactly like a manually-created one - this
 * module NEVER writes to a live dashboard itself; the caller always shows
 * an Apply/Edit/Cancel preview first.
 *
 * Multi-stage requests ("dashboard for Pressing, Mills, and the Tunnel
 * Furnace, side by side") produce ONE SECTION PER STAGE (§35), and a
 * "في <stage> أريد X و Y و Z" ("within <stage> I want X, Y, Z") clause
 * scopes those specific widgets to that stage's section - other mentioned
 * stages that got no specific instructions receive the same widget
 * template mirrored, so every requested stage still appears with real
 * content rather than sitting empty.
 *
 * Disclosed mapping: this schema's 8 real production stages do not include
 * a distinct "Tunnel Furnace" stage - "فرن نفقي" / "tunnel furnace" is
 * mapped to `sorting` (the stage whose forms describe post-tunnel-furnace
 * discharge/inspection), the closest existing match, rather than inventing
 * a 9th stage with no underlying data.
 */
import { DashboardSection, WidgetConfig, EntityType, MetricKey, TimeRangePreset, recommendChartType } from './dashboardRegistry';
import { ProductionStageType } from '../types';
import { getStageDisplayName } from './reportingEngine';
import { getStageRegistration } from './productionStageRegistry';

function genSectionId(): string { return `sec_ai_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`; }
function genWidgetId(): string { return `wid_ai_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`; }

interface KeywordEntity { entityType: EntityType; keywordsAr: string[]; keywordsEn: string[] }
const ENTITY_KEYWORDS: KeywordEntity[] = [
  { entityType: 'EMPLOYEE', keywordsAr: ['موظف', 'موظفين', 'عامل', 'عمال'], keywordsEn: ['employee', 'worker', 'staff'] },
  { entityType: 'SHIFT', keywordsAr: ['وردية', 'ورديات', 'شفت'], keywordsEn: ['shift'] },
  { entityType: 'EQUIPMENT', keywordsAr: ['مكبس', 'مكابس', 'فرن', 'أفران', 'طاحونة', 'طواحين', 'معدة', 'معدات', 'ماكينة'], keywordsEn: ['press', 'furnace', 'mill', 'equipment', 'machine'] },
  { entityType: 'PRODUCT', keywordsAr: ['منتج', 'منتجات', 'صنف', 'أصناف'], keywordsEn: ['product'] },
  { entityType: 'CUSTOMER', keywordsAr: ['عميل', 'عملاء', 'زبون'], keywordsEn: ['customer', 'client'] },
  { entityType: 'STAGE', keywordsAr: ['مرحلة', 'مراحل'], keywordsEn: ['stage'] },
];
const ENTITY_WORD_PATTERN_AR = '(?:موظف|موظفين|عامل|عمال|وردية|ورديات|شفت|مكبس|مكابس|فرن|أفران|طاحونة|طواحين|معدة|معدات|ماكينة|منتج|منتجات|صنف|أصناف|عميل|عملاء|زبون|مرحلة|مراحل)';
const ENTITY_WORD_PATTERN_EN = '(?:employee|worker|staff|shift|press|furnace|mill|equipment|machine|product|customer|client|stage)';

interface KeywordMetric { metric: MetricKey; keywordsAr: string[]; keywordsEn: string[] }
const METRIC_KEYWORDS: KeywordMetric[] = [
  { metric: 'WASTE_RATE', keywordsAr: ['نسبة الهالك', 'نسبة التالف'], keywordsEn: ['waste rate', 'waste percentage'] },
  { metric: 'WASTE_TONS', keywordsAr: ['هالك', 'تالف'], keywordsEn: ['waste', 'scrap', 'reject'] },
  { metric: 'DOWNTIME_MINUTES', keywordsAr: ['توقف', 'أعطال', 'عطل'], keywordsEn: ['downtime', 'stoppage', 'fault'] },
  { metric: 'EFFICIENCY_RATE', keywordsAr: ['كفاءة'], keywordsEn: ['efficiency'] },
  { metric: 'GOOD_TONS', keywordsAr: ['سليم', 'إنتاج سليم', 'الإنتاج السليم'], keywordsEn: ['good production', 'good tons'] },
  { metric: 'PRODUCTION_TONS', keywordsAr: ['إنتاج', 'إنتاجية'], keywordsEn: ['production', 'output'] },
];

interface KeywordStage { stage: ProductionStageType; keywordsAr: string[]; keywordsEn: string[] }
const STAGE_KEYWORDS: KeywordStage[] = [
  { stage: 'pressing', keywordsAr: ['مكبس', 'مكابس', 'التشكيل'], keywordsEn: ['press', 'pressing'] },
  { stage: 'rotary_furnace', keywordsAr: ['فرن دوار', 'الفرن الدوار'], keywordsEn: ['rotary furnace', 'rotary'] },
  { stage: 'chinese_mills', keywordsAr: ['طاحونة', 'طواحين', 'الطواحين الصينية'], keywordsEn: ['mill', 'mills', 'chinese mill'] },
  { stage: 'tube_ball_mills', keywordsAr: ['أنابيب', 'كرات'], keywordsEn: ['tube mill', 'ball mill'] },
  { stage: 'mortar_concrete', keywordsAr: ['مونة', 'خرسانة'], keywordsEn: ['mortar', 'concrete'] },
  { stage: 'mixing', keywordsAr: ['خلط'], keywordsEn: ['mixing'] },
  { stage: 'lightweight_foam', keywordsAr: ['شاموت خفيف', 'فوم'], keywordsEn: ['lightweight', 'foam'] },
  // "فرن نفقي" (tunnel furnace) has no dedicated stage in this schema - mapped to the closest real one (see file header note).
  { stage: 'sorting', keywordsAr: ['فرز', 'فرن نفقي', 'نفقي'], keywordsEn: ['sorting', 'tunnel furnace', 'tunnel'] },
];

const BEST_WORD_AR = '(?:أفضل|افضل)';
const WORST_WORD_AR = '(?:أسوأ|اسوأ)';
const BEST_WORD_EN = 'best|top|highest';
const WORST_WORD_EN = 'worst|lowest|least';

const TREND_KEYWORDS = { ar: ['اتجاه', 'خلال الوقت', 'زمني'], en: ['trend', 'over time'] };
const COMPARE_KEYWORDS = { ar: ['قارن', 'مقارنة'], en: ['compare', 'comparison', 'vs'] };

function matchesAny(text: string, words: string[]): boolean {
  return words.some((w) => text.includes(w.toLowerCase()));
}

function normalize(text: string): string {
  return text.toLowerCase();
}

export function detectStages(text: string): ProductionStageType[] {
  const found: ProductionStageType[] = [];
  for (const s of STAGE_KEYWORDS) {
    if (matchesAny(text, s.keywordsAr) || matchesAny(text, s.keywordsEn)) {
      if (!found.includes(s.stage)) found.push(s.stage);
    }
  }
  return found;
}

function stageKeywordToStage(word: string): ProductionStageType | undefined {
  const w = word.toLowerCase();
  for (const s of STAGE_KEYWORDS) {
    if (s.keywordsAr.some((k) => w.includes(k)) || s.keywordsEn.some((k) => w.includes(k))) return s.stage;
  }
  return undefined;
}

function entityWordToType(word: string): EntityType | undefined {
  const w = word.toLowerCase();
  for (const e of ENTITY_KEYWORDS) {
    if (e.keywordsAr.includes(word) || e.keywordsEn.some((k) => w === k || w.startsWith(k))) return e.entityType;
  }
  return undefined;
}

function metricKeywordInText(text: string): MetricKey | undefined {
  for (const m of METRIC_KEYWORDS) {
    if (matchesAny(text, m.keywordsAr) || matchesAny(text, m.keywordsEn)) return m.metric;
  }
  return undefined;
}

interface RankingAsk { entityType: EntityType; directions: ('best' | 'worst')[] }

/** Extracts "best/worst <entity>" and "best and worst <entity>" asks from a text segment (Part 9 §35/§39). */
function extractRankingAsks(text: string): RankingAsk[] {
  const asks: RankingAsk[] = [];
  const arPattern = new RegExp(`${BEST_WORD_AR}(\\s*و\\s*${WORST_WORD_AR})?\\s+(${ENTITY_WORD_PATTERN_AR})|${WORST_WORD_AR}\\s+(${ENTITY_WORD_PATTERN_AR})`, 'g');
  let m: RegExpExecArray | null;
  while ((m = arPattern.exec(text)) !== null) {
    if (m[2]) {
      const entityType = entityWordToType(m[2]);
      if (entityType) asks.push({ entityType, directions: m[1] ? ['best', 'worst'] : ['best'] });
    } else if (m[3]) {
      const entityType = entityWordToType(m[3]);
      if (entityType) asks.push({ entityType, directions: ['worst'] });
    }
  }
  const enPattern = new RegExp(`(${BEST_WORD_EN})(\\s+and\\s+worst)?\\s+(${ENTITY_WORD_PATTERN_EN})|(${WORST_WORD_EN})\\s+(${ENTITY_WORD_PATTERN_EN})`, 'gi');
  while ((m = enPattern.exec(text)) !== null) {
    if (m[1] && m[3]) {
      const entityType = entityWordToType(m[3]);
      if (entityType) asks.push({ entityType, directions: m[2] ? ['best', 'worst'] : ['best'] });
    } else if (m[4] && m[5]) {
      const entityType = entityWordToType(m[5]);
      if (entityType) asks.push({ entityType, directions: ['worst'] });
    }
  }
  return asks;
}

/** "حسب/بحسب <metric>" or "by <metric>" - a trailing clause that names the ranking metric explicitly (Part 9 §35). */
function extractMetricByClause(text: string): { metric: MetricKey; matchedText: string } | undefined {
  const arMatch = text.match(/(?:حسب|بحسب)\s+([^.,،]+)/);
  if (arMatch) {
    const metric = metricKeywordInText(arMatch[1]);
    if (metric) return { metric, matchedText: arMatch[0] };
  }
  const enMatch = text.match(/\bby\s+([a-z\s]+)$/i);
  if (enMatch) {
    const metric = metricKeywordInText(enMatch[1]);
    if (metric) return { metric, matchedText: enMatch[0] };
  }
  return undefined;
}

/** "آخر 30 يوم" / "last 30 days" and a few common presets (Part 9 §35). */
function extractTimeRange(text: string): { preset: TimeRangePreset; matchedText: string } | undefined {
  const t = text.toLowerCase();
  const rules: { re: RegExp; preset: TimeRangePreset }[] = [
    { re: /(آخر|اخر|last)\s*30\s*(يوم|day)/i, preset: 'LAST_30_DAYS' },
    { re: /(آخر|اخر|last)\s*7\s*(يوم|day)/i, preset: 'LAST_7_DAYS' },
    { re: /(هذا الشهر|this month)/i, preset: 'THIS_MONTH' },
    { re: /(اليوم|today)/i, preset: 'TODAY' },
  ];
  for (const r of rules) {
    const m = t.match(r.re);
    if (m) return { preset: r.preset, matchedText: m[0] };
  }
  return undefined;
}

/**
 * Consolidated UX pass Item 3 - deterministically extracts an EXPLICIT
 * "N sections, M elements each" instruction (e.g. "مقسم إلى 3 أقسام وكل قسم
 * إلى 3 عناصر" / "divided into 3 sections, 3 elements each"). When present,
 * the caller must build EXACTLY sections*elements widgets - never an
 * approximation - so this is checked BEFORE the normal heuristic
 * section-per-stage logic runs. Returns null when no explicit count is
 * named, letting the existing heuristic proposal stand unchanged.
 */
function extractExplicitSectionElementCounts(rawText: string): { sections: number; elementsPerSection: number } | null {
  const arSections = rawText.match(/(\d+)\s*(?:أقسام|اقسام)/);
  const arElements = rawText.match(/(\d+)\s*(?:عناصر|عنصر)/);
  const enSections = rawText.match(/(\d+)\s*sections?/i);
  const enElements = rawText.match(/(\d+)\s*(?:elements?|widgets?|items?)/i);

  const sections = arSections ? parseInt(arSections[1], 10) : (enSections ? parseInt(enSections[1], 10) : undefined);
  const elementsPerSection = arElements ? parseInt(arElements[1], 10) : (enElements ? parseInt(enElements[1], 10) : undefined);

  if (sections && elementsPerSection && sections > 0 && sections <= 12 && elementsPerSection > 0 && elementsPerSection <= 12) {
    return { sections, elementsPerSection };
  }
  return null;
}

/** Generic fallback metric rotation used to fill out an exact grid once real detected content (ranking asks, bare metric mentions) runs out - reused, never a hand-picked one-off list per call site. */
const DEFAULT_METRIC_POOL: MetricKey[] = ['PRODUCTION_TONS', 'GOOD_TONS', 'WASTE_RATE', 'WASTE_TONS', 'DOWNTIME_MINUTES', 'EFFICIENCY_RATE'];
const DEFAULT_ENTITY_POOL: EntityType[] = ['EQUIPMENT', 'EMPLOYEE', 'SHIFT', 'PRODUCT'];

/**
 * Builds EXACTLY `sectionsCount * elementsPerSection` widgets, arranged into
 * exactly `sectionsCount` sections of exactly `elementsPerSection` widgets
 * each. `seedWidgets` (whatever the normal keyword/ranking-ask parse already
 * detected from the request) fill the first slots so real user intent is
 * never discarded; any remaining slots are filled by deterministically
 * rotating through the stage's own registered default metrics (or the
 * generic pool if no single stage was named) and entity types, alternating
 * KPI/RANKING widget types for visual variety - never a literal duplicate of
 * the same widget repeated to hit the count.
 */
function buildExactGrid(
  sectionsCount: number,
  elementsPerSection: number,
  primaryStage: ProductionStageType | undefined,
  globalTimeRange: TimeRangePreset | 'inherit',
  seedWidgets: WidgetConfig[],
  language: 'ar' | 'en'
): DashboardSection[] {
  const stageForWidgets: ProductionStageType | 'all' | 'inherit' = primaryStage || 'inherit';
  const registeredMetrics = primaryStage ? getStageRegistration(primaryStage).defaultMetrics : [];
  const metricPool = registeredMetrics.length > 0 ? registeredMetrics : DEFAULT_METRIC_POOL;

  const totalNeeded = sectionsCount * elementsPerSection;
  const pool: WidgetConfig[] = [...seedWidgets];
  let cursor = 0;
  while (pool.length < totalNeeded) {
    const metric = metricPool[cursor % metricPool.length];
    if (cursor % 3 === 0) {
      pool.push(makeKpiWidget(metric, globalTimeRange, stageForWidgets));
    } else {
      const entityType = DEFAULT_ENTITY_POOL[cursor % DEFAULT_ENTITY_POOL.length];
      pool.push(makeRankingWidget(entityType, cursor % 2 === 0 ? 'worst' : 'best', metric, globalTimeRange, stageForWidgets));
    }
    cursor++;
  }
  const trimmed = pool.slice(0, totalNeeded);

  const sections: DashboardSection[] = [];
  for (let s = 0; s < sectionsCount; s++) {
    const widgets = trimmed.slice(s * elementsPerSection, (s + 1) * elementsPerSection).map((w) => ({ ...w, widgetId: genWidgetId() }));
    sections.push({
      sectionId: genSectionId(),
      title: language === 'ar' ? `القسم ${s + 1}` : `Section ${s + 1}`,
      columns: widgets.length >= 3 ? 3 : (Math.max(1, widgets.length) as 1 | 2 | 3),
      widgets,
    });
  }
  return sections;
}

function makeRankingWidget(entityType: EntityType, direction: 'best' | 'worst', metric: MetricKey, timeRangePreset: TimeRangePreset | 'inherit', productionStage: ProductionStageType | 'all' | 'inherit'): WidgetConfig {
  const recommendation = recommendChartType('RANKING', { entityCount: 10 });
  return {
    widgetId: genWidgetId(), widgetType: 'RANKING', analysisMode: 'RANKING', metric, entityType,
    rankingDirection: direction, limit: 5, chartType: recommendation.chartType, chartTypeIsOverride: false,
    timeRangePreset, filters: {}, productionStage,
  };
}

function makeKpiWidget(metric: MetricKey, timeRangePreset: TimeRangePreset | 'inherit', productionStage: ProductionStageType | 'all' | 'inherit'): WidgetConfig {
  return {
    widgetId: genWidgetId(), widgetType: 'KPI_CARD', analysisMode: 'SINGLE_METRIC', metric,
    chartType: 'KPI', chartTypeIsOverride: false, timeRangePreset, filters: {}, productionStage, size: 'SMALL',
  };
}

export interface AiDashboardProposal {
  sections: DashboardSection[];
  explanationAr: string;
  explanationEn: string;
  defaultsUsed: string[];
}

/**
 * Interprets `query` and returns a structured proposal. Deliberately never
 * throws on an unrecognized request - falls back to a single general
 * production-overview widget and discloses the fallback in `defaultsUsed`.
 */
export function proposeDashboardConfig(query: string, language: 'ar' | 'en'): AiDashboardProposal {
  const rawText = query;
  const text = normalize(query);
  const defaultsUsed: string[] = [];

  // Global overrides that apply to every widget produced (Part 9 §35).
  const metricByClause = extractMetricByClause(rawText);
  const timeRangeInfo = extractTimeRange(rawText);
  const globalTimeRange: TimeRangePreset | 'inherit' = timeRangeInfo?.preset || 'inherit';

  const isTrend = matchesAny(text, TREND_KEYWORDS.ar) || matchesAny(text, TREND_KEYWORDS.en);
  const isCompare = matchesAny(text, COMPARE_KEYWORDS.ar) || matchesAny(text, COMPARE_KEYWORDS.en);

  const stagesOverall = detectStages(rawText);

  // Split into "في <stage> ..." scoped segments (Part 9 §35 second example).
  // Everything before the first scope marker (if any) is treated as
  // "unscoped" - it still contributes ranking/KPI asks, just without a
  // specific stage attached.
  const scopeMarkerRe = /(?:في|for|within)\s+([^\s]+(?:\s+[^\s]+)?)/gi;
  const segments: { text: string; scopeStage?: ProductionStageType }[] = [];
  let lastIndex = 0;
  let sm: RegExpExecArray | null;
  let anyScoped = false;
  while ((sm = scopeMarkerRe.exec(rawText)) !== null) {
    const stage = stageKeywordToStage(sm[1]);
    if (!stage) continue;
    if (sm.index > lastIndex) segments.push({ text: rawText.slice(lastIndex, sm.index) });
    const nextMarker = rawText.slice(sm.index + sm[0].length).search(scopeMarkerRe);
    const segEnd = nextMarker === -1 ? rawText.length : sm.index + sm[0].length + nextMarker;
    segments.push({ text: rawText.slice(sm.index, segEnd), scopeStage: stage });
    anyScoped = true;
    lastIndex = segEnd;
    scopeMarkerRe.lastIndex = lastIndex;
  }
  if (lastIndex < rawText.length) segments.push({ text: rawText.slice(lastIndex) });
  if (segments.length === 0) segments.push({ text: rawText });

  const sectionsByStage = new Map<string, WidgetConfig[]>();
  const unscopedWidgets: WidgetConfig[] = [];
  let usedDefaultMetric = false;
  let usedDefaultEntity = false;

  for (const seg of segments) {
    const segStage: ProductionStageType | 'inherit' = seg.scopeStage || 'inherit';
    const rankingAsks = extractRankingAsks(seg.text);
    const segWidgets: WidgetConfig[] = [];

    for (const ask of rankingAsks) {
      const metric = metricByClause?.metric || metricKeywordInText(seg.text) || 'PRODUCTION_TONS';
      if (!metricByClause && !metricKeywordInText(seg.text)) usedDefaultMetric = true;
      for (const dir of ask.directions) {
        segWidgets.push(makeRankingWidget(ask.entityType, dir, metric, globalTimeRange, segStage));
      }
    }

    // Bare metric mentions with no entity attached become KPI widgets
    // (e.g. "الكفاءة" / "efficiency" alone). Skip the metric already
    // consumed by the trailing "by <metric>" clause so it isn't double-
    // counted as its own KPI.
    for (const mk of METRIC_KEYWORDS) {
      const hit = matchesAny(seg.text.toLowerCase(), mk.keywordsAr) || matchesAny(seg.text.toLowerCase(), mk.keywordsEn);
      const isTheByClauseMetric = metricByClause?.matchedText && seg.text.includes(metricByClause.matchedText) && metricByClause.metric === mk.metric;
      if (hit && !isTheByClauseMetric) {
        segWidgets.push(makeKpiWidget(mk.metric, globalTimeRange, segStage));
      }
    }

    if (segWidgets.length === 0) continue;
    if (seg.scopeStage) {
      const list = sectionsByStage.get(seg.scopeStage) || [];
      sectionsByStage.set(seg.scopeStage, [...list, ...segWidgets]);
    } else {
      unscopedWidgets.push(...segWidgets);
    }
  }

  // Consolidated UX pass Item 3 - an EXPLICIT section/element count always
  // wins over the heuristic section-per-stage/unscoped layout below: real
  // detected content (rankings/KPIs already parsed above) seeds the grid,
  // but the final shape is always EXACTLY sectionsCount x elementsPerSection
  // - never approximated up or down.
  const explicitCount = extractExplicitSectionElementCounts(rawText);
  if (explicitCount) {
    const seedWidgets: WidgetConfig[] = [...unscopedWidgets, ...Array.from(sectionsByStage.values()).flat()];
    const primaryStage = stagesOverall.length === 1 ? stagesOverall[0] : undefined;
    const exactSections = buildExactGrid(explicitCount.sections, explicitCount.elementsPerSection, primaryStage, globalTimeRange, seedWidgets, language);
    const totalWidgets = explicitCount.sections * explicitCount.elementsPerSection;
    const exactDefaultsUsed = [...defaultsUsed];
    if (seedWidgets.length < totalWidgets) {
      exactDefaultsUsed.push(language === 'ar'
        ? `تم استكمال العناصر غير المحددة صراحةً بمقاييس افتراضية مناسبة للمرحلة.`
        : 'Unspecified elements were filled in with sensible stage-appropriate default metrics.');
    }
    return {
      sections: exactSections,
      explanationAr: `تم إنشاء ${explicitCount.sections} أقسام × ${explicitCount.elementsPerSection} عناصر (${totalWidgets} عنصرًا إجمالاً) بناءً على طلبك الصريح.`,
      explanationEn: `Built exactly ${explicitCount.sections} sections x ${explicitCount.elementsPerSection} elements each (${totalWidgets} widgets total) per your explicit request.`,
      defaultsUsed: exactDefaultsUsed,
    };
  }

  const sections: DashboardSection[] = [];

  if (stagesOverall.length > 0) {
    // One section per detected stage (Part 9 §35 first example / "side by side").
    const templateWidgets = Array.from(sectionsByStage.values())[0];
    for (const stage of stagesOverall) {
      // A stage with no explicit widget instructions still gets a real,
      // stage-appropriate default (Part 10) - reads the Stage Registry's
      // own declared defaults rather than hardcoding PRODUCTION_TONS for
      // every stage regardless of what that stage actually supports.
      const registration = getStageRegistration(stage);
      const stageWidgets = sectionsByStage.get(stage)
        || (templateWidgets ? templateWidgets.map((w) => ({ ...w, widgetId: genWidgetId(), productionStage: stage })) : registration.defaultMetrics.map((m) => makeKpiWidget(m, globalTimeRange, stage)));
      sections.push({
        sectionId: genSectionId(),
        title: getStageDisplayName(stage, language),
        columns: stageWidgets.length >= 3 ? 3 : (Math.max(1, stageWidgets.length) as 1 | 2 | 3),
        widgets: stageWidgets,
      });
    }
    if (!templateWidgets) defaultsUsed.push(language === 'ar' ? 'لم تُحدد عناصر لكل مرحلة على حدة - تم استخدام مؤشر إنتاج افتراضي.' : 'No per-stage widgets specified - used a default production KPI.');
  } else if (unscopedWidgets.length > 0) {
    sections.push({
      sectionId: genSectionId(),
      title: rawText.trim().slice(0, 60) || (language === 'ar' ? 'قسم مقترح من الذكاء الاصطناعي' : 'AI-Proposed Section'),
      columns: unscopedWidgets.length >= 3 ? 3 : (Math.max(1, unscopedWidgets.length) as 1 | 2 | 3),
      widgets: unscopedWidgets,
    });
  } else {
    // Total fallback - nothing recognized at all.
    usedDefaultMetric = true;
    usedDefaultEntity = true;
    const recommendation = recommendChartType(isTrend ? 'TREND' : isCompare ? 'COMPARISON' : 'RANKING', { entityCount: 10 });
    sections.push({
      sectionId: genSectionId(),
      title: rawText.trim().slice(0, 60) || (language === 'ar' ? 'قسم مقترح من الذكاء الاصطناعي' : 'AI-Proposed Section'),
      columns: 1,
      widgets: [{
        widgetId: genWidgetId(), widgetType: 'RANKING', analysisMode: 'RANKING', metric: 'PRODUCTION_TONS',
        entityType: 'EQUIPMENT', rankingDirection: 'best', limit: 5, chartType: recommendation.chartType,
        chartTypeIsOverride: false, timeRangePreset: globalTimeRange, filters: {}, productionStage: 'inherit',
      }],
    });
  }

  if (usedDefaultMetric) defaultsUsed.push(language === 'ar' ? 'المقياس الافتراضي: إجمالي الإنتاج' : 'Default metric: Total Production');
  if (usedDefaultEntity) defaultsUsed.push(language === 'ar' ? 'التجميع الافتراضي: المعدات' : 'Default grouping: Equipment');
  if (timeRangeInfo) defaultsUsed.push(language === 'ar' ? `تم تحديد الفترة الزمنية: ${timeRangeInfo.matchedText}` : `Time range detected: ${timeRangeInfo.matchedText}`);
  if (metricByClause) defaultsUsed.push(language === 'ar' ? `تم تطبيق مقياس الترتيب: ${metricByClause.metric}` : `Applied ranking metric: ${metricByClause.metric}`);

  const totalWidgets = sections.reduce((s, sec) => s + sec.widgets.length, 0);
  const explanationAr = `تم اقتراح ${totalWidgets} عنصر عبر ${sections.length} قسم بناءً على طلبك.`;
  const explanationEn = `Proposed ${totalWidgets} widget(s) across ${sections.length} section(s) based on your request.`;

  return { sections, explanationAr, explanationEn, defaultsUsed };
}

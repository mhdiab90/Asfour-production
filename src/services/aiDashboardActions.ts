/**
 * AI Dashboard/Report Control Actions (Part 8 §33-35 of the cross-section
 * task) - parses natural-language move/filter requests into STRUCTURED
 * actions the Dashboard Builder can validate and apply itself. The AI never
 * touches React state directly and never generates code: it returns a
 * plain data object (`MoveWidgetAction` / `SetFiltersAction`), and the
 * caller (AIReportDesignerPanel, embedded inside DashboardBuilderView)
 * shows an explicit preview before the SAME permission-gated handlers a
 * human uses (`handleMoveWidgetToSection`, `setGlobalFilters`) apply it.
 *
 * Disclosed boundary: this bridge exists inside the Dashboard Builder's own
 * "AI Report Designer" panel, which already has the live draft in scope.
 * The separate floating "AI Factory Assistant" chat (GlobalAssistant.tsx)
 * does not yet expose these two actions in its own chat tool list - it
 * still only offers the Task 14 read-only analysis/ranking/report tools -
 * since wiring a live action bridge from that always-mounted global overlay
 * into whichever dashboard the user happens to have open is a larger,
 * separate architectural change this pass does not attempt.
 */
import { DashboardSection, GlobalDashboardFilters, METRIC_REGISTRY, MetricKey, EntityType, getStageDisplayName } from './dashboardRegistry';
import { Shift } from '../types';
import { detectStages } from './aiDashboardDesigner';

const MOVE_VERB_RE = /(انقل|نقل|move)/i;

interface KeywordSet { keywordsAr: string[]; keywordsEn: string[] }
const METRIC_KEYWORD_MAP: Record<MetricKey, KeywordSet> = {
  PRODUCTION_TONS: { keywordsAr: ['إنتاج', 'إنتاجية'], keywordsEn: ['production', 'output'] },
  GOOD_TONS: { keywordsAr: ['سليم', 'إنتاج سليم'], keywordsEn: ['good production', 'good tons'] },
  WASTE_TONS: { keywordsAr: ['هالك', 'تالف'], keywordsEn: ['waste', 'scrap'] },
  WASTE_RATE: { keywordsAr: ['نسبة الهالك'], keywordsEn: ['waste rate'] },
  OPERATIONS_COUNT: { keywordsAr: ['عدد التشغيلات'], keywordsEn: ['operations'] },
  DOWNTIME_MINUTES: { keywordsAr: ['توقف', 'أعطال'], keywordsEn: ['downtime', 'fault'] },
  EFFICIENCY_RATE: { keywordsAr: ['كفاءة'], keywordsEn: ['efficiency'] },
  AVG_PRODUCTION_PER_GROUP: { keywordsAr: ['متوسط الإنتاج'], keywordsEn: ['average production'] },
  MECHANICAL_FAULTS: { keywordsAr: ['أعطال ميكانيكية'], keywordsEn: ['mechanical faults'] },
  ELECTRICAL_FAULTS: { keywordsAr: ['أعطال كهربائية'], keywordsEn: ['electrical faults'] },
  WORKSHOP_FAULTS: { keywordsAr: ['أعطال ورشة'], keywordsEn: ['workshop faults'] },
  RAW_MATERIAL_FAULTS: { keywordsAr: ['أعطال خامات'], keywordsEn: ['raw material faults'] },
  OTHER_FAULTS: { keywordsAr: ['أعطال أخرى'], keywordsEn: ['other faults'] },
  TOTAL_FAULT_MINUTES: { keywordsAr: ['إجمالي دقائق الأعطال', 'إجمالي الأعطال'], keywordsEn: ['total fault minutes', 'total faults'] },
  FAULT_RATE_PER_TON: { keywordsAr: ['معدل الأعطال لكل طن'], keywordsEn: ['fault rate per ton'] },
  DOWNTIME_RATE_PER_TON: { keywordsAr: ['معدل التوقف لكل طن'], keywordsEn: ['downtime rate per ton'] },
  GAS_CONSUMPTION: { keywordsAr: ['استهلاك الغاز'], keywordsEn: ['gas consumption'] },
  ELECTRICITY_CONSUMPTION: { keywordsAr: ['استهلاك الكهرباء'], keywordsEn: ['electricity consumption'] },
  LABOR_HOURS: { keywordsAr: ['ساعات العمل'], keywordsEn: ['labor hours'] },
  PRODUCTION_PER_LABOR_HOUR: { keywordsAr: ['الإنتاج لكل ساعة عمل'], keywordsEn: ['production per labor hour'] },
};

function matchesAny(text: string, words: string[]): boolean {
  const lower = text.toLowerCase();
  return words.some((w) => lower.includes(w.toLowerCase()) || text.includes(w));
}

export interface MoveWidgetAction {
  type: 'MOVE_WIDGET';
  widgetId: string;
  sourceSectionId: string;
  sourceSectionTitle: string;
  widgetLabel: string;
  targetSectionId: string;
  targetSectionTitle: string;
}

/**
 * "انقل <widget> إلى قسم <section>" / "move <widget> to <section>". Finds
 * the target section by matching its title against the query, then finds a
 * widget (in any OTHER section) whose metric keyword appears in the query.
 * Returns null - never a guess - when either side can't be resolved
 * confidently, since a wrong silent move would be worse than declining.
 */
export function detectMoveWidgetIntent(query: string, sections: DashboardSection[]): MoveWidgetAction | null {
  if (!MOVE_VERB_RE.test(query)) return null;

  // The TARGET section name follows "قسم"/"section" (or "إلى"/"to" as a
  // fallback) - matching the whole query against every section title would
  // pick whichever title happens to occur FIRST in the sentence, which is
  // usually the SOURCE widget's own section, not the destination.
  const afterMarker = query.split(/قسم|section/i)[1] || query.split(/إلى|to\b/i)[1] || '';
  const targetSection = sections.find((s) => s.title && afterMarker.includes(s.title)) || sections.find((s) => s.title && query.includes(s.title));
  if (!targetSection) return null;

  for (const s of sections) {
    if (s.sectionId === targetSection.sectionId) continue;
    for (const w of s.widgets) {
      const kw = METRIC_KEYWORD_MAP[w.metric];
      if (kw && (matchesAny(query, kw.keywordsAr) || matchesAny(query, kw.keywordsEn))) {
        return {
          type: 'MOVE_WIDGET',
          widgetId: w.widgetId,
          sourceSectionId: s.sectionId,
          sourceSectionTitle: s.title,
          widgetLabel: w.customTitle || METRIC_REGISTRY[w.metric].labelEn,
          targetSectionId: targetSection.sectionId,
          targetSectionTitle: targetSection.title,
        };
      }
    }
  }
  return null;
}

export interface SetFiltersAction {
  type: 'SET_FILTERS';
  patch: Partial<GlobalDashboardFilters>;
  summaryAr: string;
  summaryEn: string;
}

const SHIFT_ORDINALS: { re: RegExp; num: number }[] = [
  { re: /(الأولى|أول|1st|first|shift\s*1|وردية\s*1)/i, num: 1 },
  { re: /(الثانية|ثاني|2nd|second|shift\s*2|وردية\s*2)/i, num: 2 },
  { re: /(الثالثة|ثالث|3rd|third|shift\s*3|وردية\s*3)/i, num: 3 },
];

/**
 * "اعرض لي Dashboard هذا الشهر للوردية الثانية" / "show me this month for
 * shift 2" - detects a date-range phrase and/or an ordinal shift mention
 * and resolves the shift ordinal against the REAL shifts list (never
 * fabricates a shiftId).
 */
export function detectFilterIntent(query: string, shifts: Shift[], language: 'ar' | 'en'): SetFiltersAction | null {
  const patch: Partial<GlobalDashboardFilters> = {};
  const parts: string[] = [];

  const t = query.toLowerCase();
  if (/(هذا الشهر|this month)/i.test(t)) { patch.timeRangePreset = 'THIS_MONTH'; parts.push(language === 'ar' ? 'هذا الشهر' : 'this month'); }
  else if (/(آخر|اخر|last)\s*30\s*(يوم|day)/i.test(t)) { patch.timeRangePreset = 'LAST_30_DAYS'; parts.push(language === 'ar' ? 'آخر 30 يومًا' : 'last 30 days'); }
  else if (/(آخر|اخر|last)\s*7\s*(يوم|day)/i.test(t)) { patch.timeRangePreset = 'LAST_7_DAYS'; parts.push(language === 'ar' ? 'آخر 7 أيام' : 'last 7 days'); }
  else if (/(اليوم|today)/i.test(t)) { patch.timeRangePreset = 'TODAY'; parts.push(language === 'ar' ? 'اليوم' : 'today'); }

  for (const { re, num } of SHIFT_ORDINALS) {
    if (re.test(query)) {
      const shift = shifts.find((s) => String(s.name || '').includes(String(num)) || String(s.code || '').includes(String(num)));
      if (shift?.id) {
        patch.shiftId = shift.id;
        parts.push(language === 'ar' ? `الوردية ${num}` : `Shift ${num}`);
      }
      break;
    }
  }

  const stages = detectStages(query);
  if (stages.length === 1) {
    patch.stageType = stages[0];
    parts.push(getStageDisplayName(stages[0], language));
  }

  if (Object.keys(patch).length === 0) return null;
  return {
    type: 'SET_FILTERS',
    patch,
    summaryAr: `تعيين الفلاتر: ${parts.join('، ')}`,
    summaryEn: `Set filters: ${parts.join(', ')}`,
  };
}

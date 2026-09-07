/**
 * AI Report Designer preview panel (§22-24, Part 8 §33-35). The user types
 * a request in Arabic or English and sees a STRUCTURED proposal before
 * anything changes - either a new dashboard/report section proposal
 * (widgets built purely from dashboardRegistry.ts), a widget MOVE action,
 * or a filter-configuration action. Every path shows Apply/Cancel; nothing
 * is ever applied automatically.
 *
 * Move/filter detection runs FIRST against the CURRENT draft, since those
 * are unambiguous, narrow intents ("move X to section Y", "show me this
 * month for shift 2") - falling through to the general dashboard-builder
 * proposal only when neither matches.
 */
import React, { useState } from 'react';
import { Sparkles, Wand2, AlertCircle, MoveRight, Filter } from 'lucide-react';
import { Modal } from '../common/Modal';
import { proposeDashboardConfig, AiDashboardProposal } from '../../services/aiDashboardDesigner';
import { detectMoveWidgetIntent, detectFilterIntent, MoveWidgetAction, SetFiltersAction } from '../../services/aiDashboardActions';
import { getMetricLabel, DashboardSection } from '../../services/dashboardRegistry';
import { Shift } from '../../types';

interface AIReportDesignerPanelProps {
  language: 'ar' | 'en';
  currentSections: DashboardSection[];
  shifts: Shift[];
  onCancel: () => void;
  onApply: (sections: DashboardSection[]) => void;
  onMoveWidget: (action: MoveWidgetAction) => void;
  onSetFilters: (action: SetFiltersAction) => void;
}

const EXAMPLES = {
  ar: ['اعمل لي لوحة تعرض أفضل المكابس من حيث الإنتاج', 'قارن الورديات من حيث الهالك', 'اتجاه الإنتاج خلال الوقت'],
  en: ['Show me the best presses by production', 'Compare shifts by waste', 'Production trend over time'],
};

type ResultState =
  | { kind: 'PROPOSAL'; proposal: AiDashboardProposal }
  | { kind: 'MOVE'; action: MoveWidgetAction }
  | { kind: 'FILTERS'; action: SetFiltersAction }
  | null;

export const AIReportDesignerPanel: React.FC<AIReportDesignerPanelProps> = ({
  language, currentSections, shifts, onCancel, onApply, onMoveWidget, onSetFilters,
}) => {
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<ResultState>(null);

  const t = {
    title: language === 'ar' ? 'مصمم التقارير بالذكاء الاصطناعي' : 'AI Report Designer',
    subtitle: language === 'ar' ? 'صف اللوحة التي تريدها، أو اطلب نقل عنصر، أو غيّر الفلاتر بكلماتك' : 'Describe the dashboard you want, ask to move a widget, or change filters in your own words',
    placeholder: language === 'ar' ? 'مثال: اعمل لي لوحة تعرض أفضل المكابس من حيث الإنتاج' : 'e.g. Show me the best presses by production',
    generate: language === 'ar' ? 'إنشاء اقتراح' : 'Generate Proposal',
    examples: language === 'ar' ? 'أمثلة:' : 'Examples:',
    preview: language === 'ar' ? 'معاينة الاقتراح' : 'Proposal Preview',
    defaultsUsed: language === 'ar' ? 'افتراضات مستخدمة (لم يتم ذكرها في طلبك):' : 'Defaults used (not mentioned in your request):',
    apply: language === 'ar' ? 'تطبيق على اللوحة' : 'Apply to Dashboard',
    cancel: language === 'ar' ? 'إلغاء' : 'Cancel',
    editNote: language === 'ar' ? 'يمكنك تعديل أي عنصر بعد التطبيق من زر التعديل الخاص به.' : 'You can edit any widget after applying it, using its own edit button.',
    moveTitle: language === 'ar' ? 'اقتراح نقل عنصر' : 'Move Widget Proposal',
    moveDescription: (a: MoveWidgetAction) => language === 'ar'
      ? `نقل "${a.widgetLabel}" من قسم "${a.sourceSectionTitle}" إلى قسم "${a.targetSectionTitle}".`
      : `Move "${a.widgetLabel}" from section "${a.sourceSectionTitle}" to section "${a.targetSectionTitle}".`,
    applyMove: language === 'ar' ? 'تطبيق النقل' : 'Apply Move',
    filterTitle: language === 'ar' ? 'اقتراح تعيين فلاتر' : 'Set Filters Proposal',
    applyFilters: language === 'ar' ? 'تطبيق الفلاتر' : 'Apply Filters',
    notUnderstood: language === 'ar' ? 'لم يتم التعرف على طلب محدد للنقل أو الفلاتر - سيتم اقتراح لوحة جديدة بدلًا من ذلك.' : 'No specific move/filter request recognized - proposing a new dashboard instead.',
  };

  const handleGenerate = (q: string) => {
    if (!q.trim()) return;
    const moveAction = detectMoveWidgetIntent(q, currentSections);
    if (moveAction) { setResult({ kind: 'MOVE', action: moveAction }); return; }
    const filterAction = detectFilterIntent(q, shifts, language);
    if (filterAction) { setResult({ kind: 'FILTERS', action: filterAction }); return; }
    setResult({ kind: 'PROPOSAL', proposal: proposeDashboardConfig(q, language) });
  };

  return (
    <Modal isOpen onClose={onCancel} title={t.title} subtitle={t.subtitle} maxWidth="2xl">
      <div className="space-y-4" dir={language === 'ar' ? 'rtl' : 'ltr'}>
        <div className="flex items-center gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleGenerate(query); }}
            placeholder={t.placeholder}
            className="flex-1 border border-slate-200 rounded px-3 py-2 text-sm"
            autoFocus
          />
          <button type="button" onClick={() => handleGenerate(query)} className="flex items-center gap-1.5 px-3 py-2 bg-violet-600 hover:bg-violet-700 text-white text-xs font-bold rounded cursor-pointer whitespace-nowrap">
            <Wand2 className="w-3.5 h-3.5" />{t.generate}
          </button>
        </div>

        {!result && (
          <div className="text-[11px] text-slate-400">
            <p className="mb-1">{t.examples}</p>
            <div className="flex flex-wrap gap-1.5">
              {EXAMPLES[language].map((ex) => (
                <button key={ex} type="button" onClick={() => { setQuery(ex); handleGenerate(ex); }} className="px-2 py-1 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded text-slate-600 cursor-pointer">
                  {ex}
                </button>
              ))}
            </div>
          </div>
        )}

        {result?.kind === 'MOVE' && (
          <div className="bg-violet-50 border border-violet-200 rounded p-3 text-xs text-violet-800 flex items-start gap-2">
            <MoveRight className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{t.moveDescription(result.action)}</span>
          </div>
        )}

        {result?.kind === 'FILTERS' && (
          <div className="bg-violet-50 border border-violet-200 rounded p-3 text-xs text-violet-800 flex items-start gap-2">
            <Filter className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{language === 'ar' ? result.action.summaryAr : result.action.summaryEn}</span>
          </div>
        )}

        {result?.kind === 'PROPOSAL' && (
          <div className="space-y-3">
            <div className="bg-violet-50 border border-violet-200 rounded p-3 text-xs text-violet-800 flex items-start gap-2">
              <Sparkles className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{language === 'ar' ? result.proposal.explanationAr : result.proposal.explanationEn}</span>
            </div>

            {result.proposal.defaultsUsed.length > 0 && (
              <div className="bg-amber-50 border border-amber-200 rounded p-3 text-[11px] text-amber-800 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <div>
                  <p className="font-bold">{t.defaultsUsed}</p>
                  <ul className="list-disc ps-4 mt-1">{result.proposal.defaultsUsed.map((d, i) => <li key={i}>{d}</li>)}</ul>
                </div>
              </div>
            )}

            <div>
              <p className="text-xs font-bold text-slate-600 mb-1.5">{t.preview}</p>
              <div className="space-y-3">
                {result.proposal.sections.map((section) => (
                  <div key={section.sectionId}>
                    {result.proposal.sections.length > 1 && <p className="text-[10px] font-bold text-indigo-600 uppercase mb-1">{section.title}</p>}
                    <div className="space-y-1.5">
                      {section.widgets.map((w) => (
                        <div key={w.widgetId} className="flex items-center justify-between border border-slate-200 rounded px-3 py-2 bg-white">
                          <div>
                            <p className="text-xs font-bold text-slate-700">{w.customTitle || getMetricLabel(w.metric, language)}</p>
                            <p className="text-[10px] text-slate-400">{w.widgetType} · {w.chartType}{w.entityType ? ` · ${w.entityType}` : ''}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <p className="text-[10px] text-slate-400">{t.editNote}</p>
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
          <button type="button" onClick={onCancel} className="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded cursor-pointer">{t.cancel}</button>
          {result?.kind === 'MOVE' && (
            <button type="button" onClick={() => onMoveWidget(result.action)} className="px-4 py-2 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded cursor-pointer">{t.applyMove}</button>
          )}
          {result?.kind === 'FILTERS' && (
            <button type="button" onClick={() => onSetFilters(result.action)} className="px-4 py-2 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded cursor-pointer">{t.applyFilters}</button>
          )}
          {result?.kind === 'PROPOSAL' && (
            <button type="button" onClick={() => onApply(result.proposal.sections)} className="px-4 py-2 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded cursor-pointer">{t.apply}</button>
          )}
        </div>
      </div>
    </Modal>
  );
};

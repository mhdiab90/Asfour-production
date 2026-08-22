/**
 * AI Factory Analytics & Natural Language Query Assistant
 * Features:
 * - Natural language queries in Arabic analyzing real Firestore production records
 * - Pre-configured fast queries (الأعطال، الغاز، الهالك، العملاء، الورديات)
 * - Real data aggregation with visual KPI badges and AI-generated analytical summary
 * - Actionable factory insights & root-cause recommendations
 */
import React, { useState } from 'react';
import { 
  Sparkles, 
  Send, 
  Bot, 
  User, 
  Clock, 
  TrendingUp, 
  AlertTriangle, 
  Flame, 
  Users, 
  BarChart3, 
  Lightbulb,
  Loader2,
  CheckCircle2,
  HelpCircle
} from 'lucide-react';
import { askFactoryAI, AIQueryResult } from '../../services/aiService';

const SUGGESTED_QUERIES = [
  'ما هو أكثر سبب أعطال أثر على الإنتاج هذا الشهر؟',
  'قارن استهلاك الغاز ومعدلات الحرق في الأفران',
  'ما هي الوردية الأعلى إنتاجية وكفاءة تشغيلية؟',
  'ما هي نسبة الهالك وأكثر العيوب في مرحلة الفرز؟',
  'أعلى العملاء استلاماً للطلبيات والشحنات',
];

export const AIAssistantView: React.FC = () => {
  const [query, setQuery] = useState('');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [messages, setMessages] = useState<{ id: string; role: 'user' | 'assistant'; text?: string; result?: AIQueryResult }[]>([
    {
      id: 'welcome',
      role: 'assistant',
      text: 'أهلاً بك في المساعد الذكي لمصنع عصفور للحراريات! 🏭\nيمكنك سؤالي باللغة العربية عن أي تفاصيل تخص الإنتاج، نسب الهالك، استهلاك الغاز، توقفات المعدات، أو أداء الورديات.',
    }
  ]);

  const handleSend = async (questionToSend?: string) => {
    const q = questionToSend || query;
    if (!q.trim() || isLoading) return;

    const userMsgId = Date.now().toString();
    setMessages(prev => [...prev, { id: userMsgId, role: 'user', text: q }]);
    setQuery('');
    setIsLoading(true);

    try {
      const aiResult = await askFactoryAI(q);
      const botMsgId = (Date.now() + 1).toString();
      setMessages(prev => [...prev, { id: botMsgId, role: 'assistant', result: aiResult }]);
    } catch (e: any) {
      setMessages(prev => [...prev, {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        text: 'عذراً، حدث خطأ أثناء تحليل بيانات المصنع: ' + (e.message || 'حاول مجدداً.'),
      }]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-6" dir="rtl">
      {/* Header */}
      <div className="bg-gradient-to-r from-red-600 to-rose-700 p-6 rounded-3xl text-white shadow-lg relative overflow-hidden">
        <div className="relative z-10">
          <div className="inline-flex items-center gap-2 px-3 py-1 bg-white/20 backdrop-blur-md rounded-full text-xs font-bold mb-3">
            <Sparkles className="w-3.5 h-3.5 text-amber-300" />
            محرك التحليل الذكي لمصنع عصفور (ASFOUR Factory Intelligence)
          </div>
          <h1 className="text-2xl font-black mb-1">
            المساعد الذكي وتحليلات اللغة الطبيعية
          </h1>
          <p className="text-xs text-red-100 max-w-2xl">
            اطرح أي استفسار حول كفاءة التشغيل، استهلاك الطاقة، أسباب الهالك، وتوقفات الماكينات باللغة العربية
          </p>
        </div>
      </div>

      {/* Suggested Quick Queries */}
      <div className="flex items-center gap-2 overflow-x-auto pb-2 scrollbar-thin">
        <span className="text-xs font-bold text-slate-500 whitespace-nowrap flex items-center gap-1">
          <Lightbulb className="w-3.5 h-3.5 text-amber-500" />
          أسئلة مقترحة:
        </span>
        {SUGGESTED_QUERIES.map((sq, idx) => (
          <button
            key={idx}
            type="button"
            onClick={() => handleSend(sq)}
            className="px-3.5 py-1.5 bg-white hover:bg-red-50 text-slate-700 hover:text-red-700 border border-slate-200 hover:border-red-200 rounded-xl text-xs font-bold whitespace-nowrap transition-all shadow-2xs cursor-pointer"
          >
            {sq}
          </button>
        ))}
      </div>

      {/* Chat Messages Log */}
      <div className="bg-white rounded-3xl border border-slate-200 shadow-xs p-4 sm:p-6 min-h-[420px] max-h-[600px] overflow-y-auto space-y-4">
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex items-start gap-3 ${
              msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'
            }`}
          >
            <div className={`w-9 h-9 rounded-2xl flex items-center justify-center shrink-0 font-bold ${
              msg.role === 'user' ? 'bg-slate-900 text-white' : 'bg-red-600 text-white'
            }`}>
              {msg.role === 'user' ? <User className="w-4 h-4" /> : <Bot className="w-5 h-5" />}
            </div>

            <div className={`max-w-[85%] sm:max-w-2xl rounded-2xl p-4 text-xs ${
              msg.role === 'user'
                ? 'bg-slate-900 text-white'
                : 'bg-slate-50 border border-slate-200 text-slate-900 space-y-3'
            }`}>
              {msg.text && (
                <p className="whitespace-pre-line leading-relaxed font-semibold">
                  {msg.text}
                </p>
              )}

              {msg.result && (
                <div className="space-y-4">
                  {/* Summary Narrative */}
                  <p className="font-bold text-slate-800 text-sm leading-relaxed">
                    {msg.result.summary}
                  </p>

                  {/* Visual Data Breakdown Cards */}
                  {msg.result.data && msg.result.data.length > 0 && (
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 pt-2">
                      {msg.result.data.map((item, idx) => (
                        <div key={idx} className="bg-white p-3 rounded-xl border border-slate-200">
                          <span className="text-[11px] font-bold text-slate-500 block truncate">{item.label}</span>
                          <span className="text-sm font-black text-slate-900 block mt-0.5">
                            {typeof item.value === 'number' ? item.value.toLocaleString() : item.value}
                          </span>
                          {item.subtext && (
                            <span className="text-[10px] font-semibold text-red-600 block mt-0.5">
                              {item.subtext}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Actionable Recommendations */}
                  {msg.result.recommendations && msg.result.recommendations.length > 0 && (
                    <div className="bg-emerald-50/70 border border-emerald-200 rounded-xl p-3.5 space-y-2">
                      <span className="text-xs font-bold text-emerald-950 flex items-center gap-1.5">
                        <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                        توصيات وخطة عمل مقترحة للمصنع:
                      </span>
                      <ul className="space-y-1 pr-4 list-disc text-emerald-900 font-medium">
                        {msg.result.recommendations.map((rec, rIdx) => (
                          <li key={rIdx}>{rec}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}

        {isLoading && (
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-2xl bg-red-600 text-white flex items-center justify-center">
              <Bot className="w-5 h-5" />
            </div>
            <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 flex items-center gap-2 text-xs font-bold text-slate-600">
              <Loader2 className="w-4 h-4 animate-spin text-red-600" />
              جاري فحص قواعد بيانات الإنتاج وتحليل الأرقام...
            </div>
          </div>
        )}
      </div>

      {/* Input Bar */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          handleSend();
        }}
        className="bg-white rounded-2xl border border-slate-200 p-2 shadow-sm flex items-center gap-2"
      >
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="اكتب سؤالك باللغة العربية (مثال: ما هو سبب العطل الأكبر الأسبوع الحالي؟)..."
          className="flex-1 px-4 py-2.5 text-xs bg-transparent border-none outline-none font-bold text-slate-900 placeholder:text-slate-400"
        />
        <button
          type="submit"
          disabled={isLoading || !query.trim()}
          className="flex items-center gap-1.5 px-5 py-2.5 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-xs font-bold rounded-xl shadow-xs transition-all cursor-pointer"
        >
          <Send className="w-3.5 h-3.5 rotate-180" />
          إرسال
        </button>
      </form>
    </div>
  );
};

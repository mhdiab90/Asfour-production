/**
 * Production Stage Selector Component
 * Presents visual touch-friendly cards and quick select for all 8 ASFOUR manufacturing stages.
 */
import React from 'react';
import { 
  Wrench, 
  Flame, 
  RotateCw, 
  Layers, 
  Boxes, 
  FlaskConical, 
  Feather, 
  CheckCircle2,
  ChevronDown
} from 'lucide-react';
import { ProductionStageType } from '../../types';

export interface StageDefinition {
  id: ProductionStageType;
  code: string;
  nameAr: string;
  nameEn: string;
  descriptionAr: string;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
  badge: string;
}

export const PRODUCTION_STAGES: StageDefinition[] = [
  {
    id: 'pressing',
    code: 'STAGE-1',
    nameAr: 'التشكيل والمكابس',
    nameEn: 'Press Production',
    descriptionAr: 'تشكيل الطوب الحراري، المكابس الهيدروليكية والميكانيكية، عمالة التشكيل وعربات الفرن',
    icon: Wrench,
    color: 'sky',
    badge: 'المرحلة 1',
  },
  {
    id: 'rotary_furnace',
    code: 'STAGE-2',
    nameAr: 'الفرن الدوار',
    nameEn: 'Rotary Furnace',
    descriptionAr: 'تكليس الخامات، استهلاك الغاز الطبيعي والكهرباء، الدفعات والخلطات ومعدلات الحرق',
    icon: Flame,
    color: 'red',
    badge: 'المرحلة 2',
  },
  {
    id: 'chinese_mills',
    code: 'STAGE-3',
    nameAr: 'الطواحين الصينية',
    nameEn: 'Chinese Mills',
    descriptionAr: 'طحن الخامات الحرارية الناعمة، عدد الشكائر، العميل، التوالف ومعدلات التشغيل بالساعة',
    icon: RotateCw,
    color: 'amber',
    badge: 'المرحلة 3',
  },
  {
    id: 'tube_ball_mills',
    code: 'STAGE-4',
    nameAr: 'طواحين الأنابيب والكرات',
    nameEn: 'Tube & Ball Mills',
    descriptionAr: 'طحن الخامات بالكرات، الصوامع والبناكر، ساعات التشغيل ومعدل الطن/ساعة',
    icon: Layers,
    color: 'purple',
    badge: 'المرحلة 4',
  },
  {
    id: 'mortar_concrete',
    code: 'STAGE-5',
    nameAr: 'المونة والخرسانات الحرارية',
    nameEn: 'Mortar & Concrete',
    descriptionAr: 'إنتاج خلطات المونة والخرسانات، أوامر التصنيع، الخامات المستخدمة والعملاء',
    icon: Boxes,
    color: 'emerald',
    badge: 'المرحلة 5',
  },
  {
    id: 'mixing',
    code: 'STAGE-6',
    nameAr: 'الخلط والتجهيز',
    nameEn: 'Mixing Stage',
    descriptionAr: 'تجهيز وتجنيس الخلطات الحرارية، الخامات المستخدمة، نسب الإضافة ومعدلات الإنتاج',
    icon: FlaskConical,
    color: 'indigo',
    badge: 'المرحلة 6',
  },
  {
    id: 'lightweight_foam',
    code: 'STAGE-7',
    nameAr: 'الشاموت الخفيف وعزل الفوم',
    nameEn: 'Lightweight & Foam',
    descriptionAr: 'إنتاج الطوب العازل الخفيف، الخامات المستخدمة، نسب المسامية ومعدل الهالك',
    icon: Feather,
    color: 'teal',
    badge: 'المرحلة 7',
  },
  {
    id: 'sorting',
    code: 'STAGE-8',
    nameAr: 'الفرز والمراقبة وتصنيف العيوب',
    nameEn: 'Sorting & Inspection',
    descriptionAr: 'فرز المنتج بعد الحرق، وزن القطعة، وتصنيف دقيق لعيوب الشطف، الشروخ، بقع الحديد والمرتجع',
    icon: CheckCircle2,
    color: 'rose',
    badge: 'المرحلة 8',
  },
];

interface ProductionStageSelectorProps {
  selectedStage: ProductionStageType;
  onSelectStage: (stage: ProductionStageType) => void;
}

export const ProductionStageSelector: React.FC<ProductionStageSelectorProps> = ({
  selectedStage,
  onSelectStage,
}) => {
  return (
    <div className="w-full mb-6" dir="rtl">
      {/* Quick mobile dropdown */}
      <div className="md:hidden mb-4">
        <label className="block text-xs font-bold text-slate-700 mb-1.5">
          اختر مرحلة الإنتاج:
        </label>
        <div className="relative">
          <select
            id="mobile-stage-selector"
            value={selectedStage}
            onChange={(e) => onSelectStage(e.target.value as ProductionStageType)}
            className="w-full appearance-none bg-white border border-slate-300 rounded-xl px-4 py-3 text-sm font-bold text-slate-800 focus:ring-2 focus:ring-red-500/20 focus:border-red-500 outline-none shadow-xs"
          >
            {PRODUCTION_STAGES.map((st) => (
              <option key={st.id} value={st.id}>
                {st.badge}: {st.nameAr}
              </option>
            ))}
          </select>
          <ChevronDown className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
        </div>
      </div>

      {/* Grid of visual cards (Desktop & Tablet) */}
      <div className="hidden md:grid grid-cols-2 lg:grid-cols-4 gap-3">
        {PRODUCTION_STAGES.map((st) => {
          const Icon = st.icon;
          const isSelected = selectedStage === st.id;

          return (
            <button
              key={st.id}
              id={`stage-card-${st.id}`}
              type="button"
              onClick={() => onSelectStage(st.id)}
              className={`text-right p-3.5 rounded-2xl border transition-all duration-150 relative flex flex-col justify-between cursor-pointer ${
                isSelected
                  ? 'bg-slate-900 border-slate-900 text-white shadow-lg ring-2 ring-red-500/30 -translate-y-0.5'
                  : 'bg-white border-slate-200 text-slate-800 hover:border-slate-300 hover:bg-slate-50/80 shadow-xs'
              }`}
            >
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div
                    className={`w-9 h-9 rounded-xl flex items-center justify-center ${
                      isSelected
                        ? 'bg-red-600 text-white'
                        : 'bg-slate-100 text-slate-700'
                    }`}
                  >
                    <Icon className="w-5 h-5" />
                  </div>
                  <span
                    className={`text-[10px] font-bold px-2 py-0.5 rounded-md ${
                      isSelected
                        ? 'bg-slate-800 text-red-400 border border-slate-700'
                        : 'bg-slate-100 text-slate-600 border border-slate-200'
                    }`}
                  >
                    {st.badge}
                  </span>
                </div>

                <h3 className={`text-sm font-bold truncate mb-1 ${isSelected ? 'text-white' : 'text-slate-900'}`}>
                  {st.nameAr}
                </h3>
                <p
                  className={`text-[11px] line-clamp-2 leading-relaxed ${
                    isSelected ? 'text-slate-400' : 'text-slate-500'
                  }`}
                >
                  {st.descriptionAr}
                </p>
              </div>

              {isSelected && (
                <div className="mt-2.5 pt-2 border-t border-slate-800 flex items-center justify-between text-[11px] font-bold text-red-400">
                  <span>المرحلة المحددة حالياً</span>
                  <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
};

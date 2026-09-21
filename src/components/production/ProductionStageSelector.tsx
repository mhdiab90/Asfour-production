/**
 * Production Stage Selector Component
 * Presents visual touch-friendly cards and quick select for all 8 ASFOUR manufacturing stages.
 *
 * English stage names are aligned with reportingEngine.ts's STAGE_DISPLAY_NAMES_EN
 * (the names already shown across Reports/Dashboard/AI tools) rather than
 * inventing new ones here, per the terminology-consistency requirement.
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
  ChevronDown,
  Layers3,
  Flame as KilnIcon,
  Hand
} from 'lucide-react';
import { ProductionStageType } from '../../types';
import { useLanguage } from '../../i18n/LanguageContext';

export interface StageDefinition {
  id: ProductionStageType;
  code: string;
  nameAr: string;
  nameEn: string;
  descriptionAr: string;
  descriptionEn: string;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
  badgeAr: string;
  badgeEn: string;
}

export const PRODUCTION_STAGES: StageDefinition[] = [
  {
    id: 'pressing',
    code: 'STAGE-1',
    nameAr: 'التشكيل والمكابس',
    nameEn: 'Pressing',
    descriptionAr: 'تشكيل الطوب الحراري، المكابس الهيدروليكية والميكانيكية، عمالة التشكيل وعربات الفرن',
    descriptionEn: 'Refractory brick pressing, hydraulic & mechanical presses, forming labor, and furnace cars',
    icon: Wrench,
    color: 'sky',
    badgeAr: 'المرحلة 1',
    badgeEn: 'Stage 1',
  },
  {
    id: 'rotary_furnace',
    code: 'STAGE-2',
    nameAr: 'الفرن الدوار',
    nameEn: 'Rotary Furnace',
    descriptionAr: 'تكليس الخامات، استهلاك الغاز الطبيعي والكهرباء، الدفعات والخلطات ومعدلات الحرق',
    descriptionEn: 'Raw material calcination, natural gas & electricity consumption, batches, and firing rates',
    icon: Flame,
    color: 'red',
    badgeAr: 'المرحلة 2',
    badgeEn: 'Stage 2',
  },
  {
    id: 'chinese_mills',
    code: 'STAGE-3',
    nameAr: 'الطواحين الصينية',
    nameEn: 'Chinese Mills',
    descriptionAr: 'طحن الخامات الحرارية الناعمة، عدد الشكائر، العميل، التوالف ومعدلات التشغيل بالساعة',
    descriptionEn: 'Fine refractory material grinding, bag counts, customer, rejects, and hourly operating rates',
    icon: RotateCw,
    color: 'amber',
    badgeAr: 'المرحلة 3',
    badgeEn: 'Stage 3',
  },
  {
    id: 'tube_ball_mills',
    code: 'STAGE-4',
    nameAr: 'طواحين الأنابيب والكرات',
    nameEn: 'Tube / Ball Mills',
    descriptionAr: 'طحن الخامات بالكرات، الصوامع والبناكر، ساعات التشغيل ومعدل الطن/ساعة',
    descriptionEn: 'Ball-mill grinding, silos & bunkers, operating hours, and tons/hour rate',
    icon: Layers,
    color: 'purple',
    badgeAr: 'المرحلة 4',
    badgeEn: 'Stage 4',
  },
  {
    id: 'mortar_concrete',
    code: 'STAGE-5',
    nameAr: 'المونة والخرسانات الحرارية',
    nameEn: 'Mortar & Concrete',
    descriptionAr: 'إنتاج خلطات المونة والخرسانات، أوامر التصنيع، الخامات المستخدمة والعملاء',
    descriptionEn: 'Mortar & refractory concrete mix production, manufacturing orders, materials used, and customers',
    icon: Boxes,
    color: 'emerald',
    badgeAr: 'المرحلة 5',
    badgeEn: 'Stage 5',
  },
  {
    id: 'mixing',
    code: 'STAGE-6',
    nameAr: 'الخلط والتجهيز',
    nameEn: 'Mixing',
    descriptionAr: 'تجهيز وتجنيس الخلطات الحرارية، الخامات المستخدمة، نسب الإضافة ومعدلات الإنتاج',
    descriptionEn: 'Refractory mix preparation & homogenization, materials used, addition ratios, and output rates',
    icon: FlaskConical,
    color: 'indigo',
    badgeAr: 'المرحلة 6',
    badgeEn: 'Stage 6',
  },
  {
    id: 'lightweight_foam',
    code: 'STAGE-7',
    nameAr: 'الشاموت الخفيف وعزل الفوم',
    nameEn: 'Lightweight Foam',
    descriptionAr: 'إنتاج الطوب العازل الخفيف، الخامات المستخدمة، نسب المسامية ومعدل الهالك',
    descriptionEn: 'Lightweight insulating brick production, materials used, porosity ratios, and waste rate',
    icon: Feather,
    color: 'teal',
    badgeAr: 'المرحلة 7',
    badgeEn: 'Stage 7',
  },
  {
    id: 'sorting',
    code: 'STAGE-8',
    nameAr: 'الفرز والمراقبة وتصنيف العيوب',
    nameEn: 'Sorting',
    descriptionAr: 'فرز المنتج بعد الحرق، وزن القطعة، وتصنيف دقيق لعيوب الشطف، الشروخ، بقع الحديد والمرتجع',
    descriptionEn: 'Post-firing product sorting, piece weight, and detailed defect classification (chipping, cracks, iron spots, returns)',
    icon: CheckCircle2,
    color: 'rose',
    badgeAr: 'المرحلة 8',
    badgeEn: 'Stage 8',
  },
  // Phase 1 Step 8C-5: the remaining production areas.
  {
    id: 'thermal_concrete',
    code: 'STAGE-9',
    nameAr: 'الخرسانة الحرارية',
    nameEn: 'Thermal Concrete',
    descriptionAr: 'إنتاج الخرسانات الحرارية (Castables)، الخامات المستخدمة، الكمية بالطن والتعبئة',
    descriptionEn: 'Refractory castable production, materials used, quantity in tons, and packing',
    icon: Layers3,
    color: 'orange',
    badgeAr: 'المرحلة 9',
    badgeEn: 'Stage 9',
  },
  {
    id: 'tunnel_kiln',
    code: 'STAGE-10',
    nameAr: 'الفرن النفقي',
    nameEn: 'Tunnel Kiln',
    descriptionAr: 'حريق الطوب الأخضر، الفرن والعربات، الكمية المحروقة بالطن',
    descriptionEn: 'Green brick firing, kiln and cars, fired quantity in tons',
    icon: KilnIcon,
    color: 'orange',
    badgeAr: 'المرحلة 10',
    badgeEn: 'Stage 10',
  },
  {
    id: 'handmade_brick',
    code: 'STAGE-11',
    nameAr: 'الطوب اليدوي',
    nameEn: 'Hand-made Brick',
    descriptionAr: 'تشكيل الطوب يدويًا، عدد القطع ووزن القطعة، الخامات المستخدمة',
    descriptionEn: 'Hand-formed bricks, piece count and piece weight, materials used',
    icon: Hand,
    color: 'orange',
    badgeAr: 'المرحلة 11',
    badgeEn: 'Stage 11',
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
  const { language, isRtl } = useLanguage();

  return (
    <div className="w-full mb-6" dir={isRtl ? 'rtl' : 'ltr'}>
      {/* Quick mobile dropdown */}
      <div className="md:hidden mb-4">
        <label className="block text-xs font-bold text-slate-700 mb-1.5">
          {language === 'ar' ? 'اختر مرحلة الإنتاج:' : 'Select Production Stage:'}
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
                {language === 'ar' ? `${st.badgeAr}: ${st.nameAr}` : `${st.badgeEn}: ${st.nameEn}`}
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
                    {language === 'ar' ? st.badgeAr : st.badgeEn}
                  </span>
                </div>

                <h3 className={`text-sm font-bold truncate mb-1 ${isSelected ? 'text-white' : 'text-slate-900'}`}>
                  {language === 'ar' ? st.nameAr : st.nameEn}
                </h3>
                <p
                  className={`text-[11px] line-clamp-2 leading-relaxed ${
                    isSelected ? 'text-slate-400' : 'text-slate-500'
                  }`}
                >
                  {language === 'ar' ? st.descriptionAr : st.descriptionEn}
                </p>
              </div>

              {isSelected && (
                <div className="mt-2.5 pt-2 border-t border-slate-800 flex items-center justify-between text-[11px] font-bold text-red-400">
                  <span>{language === 'ar' ? 'المرحلة المحددة حالياً' : 'Currently Selected Stage'}</span>
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

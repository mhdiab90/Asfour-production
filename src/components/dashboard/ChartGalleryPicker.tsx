/**
 * Chart Gallery Picker (Part 4 §14-16) - every chart type shows a real mini
 * visual preview next to its name and a short description, not a bare text
 * list in a `<select>`. The currently-recommended type (from
 * dashboardRegistry.ts's recommendChartType()) carries a "Recommended"
 * badge; picking a different one is an explicit, visible override.
 */
import React from 'react';
import { Star } from 'lucide-react';
import { ChartType, CHART_TYPE_LABELS } from '../../services/dashboardRegistry';

interface ChartGalleryPickerProps {
  value: ChartType;
  recommended: ChartType;
  onChange: (chartType: ChartType) => void;
  language: 'ar' | 'en';
  options: ChartType[];
}

const NAME = CHART_TYPE_LABELS;

const previewColor = '#4f46e5';
const previewColor2 = '#a5b4fc';

function MiniPreview({ type }: { type: ChartType }) {
  const common = { width: 64, height: 36, viewBox: '0 0 64 36' };
  switch (type) {
    case 'BAR':
    case 'GROUPED_BAR':
    case 'STACKED_BAR':
    case 'COMBO':
      return (
        <svg {...common}><rect x="6" y="16" width="8" height="16" fill={previewColor} /><rect x="18" y="8" width="8" height="24" fill={previewColor} /><rect x="30" y="20" width="8" height="12" fill={previewColor2} /><rect x="42" y="4" width="8" height="28" fill={previewColor} />
        {type === 'COMBO' && <polyline points="10,20 22,12 34,18 46,6" fill="none" stroke="#f59e0b" strokeWidth="2" />}
        </svg>
      );
    case 'HORIZONTAL_BAR':
    case 'RANKING_LIST':
      return (
        <svg {...common}><rect x="4" y="4" width="44" height="6" fill={previewColor} /><rect x="4" y="14" width="34" height="6" fill={previewColor} /><rect x="4" y="24" width="24" height="6" fill={previewColor2} /></svg>
      );
    case 'LINE':
    case 'MULTI_LINE':
      return (
        <svg {...common}><polyline points="4,28 16,14 28,20 40,6 60,16" fill="none" stroke={previewColor} strokeWidth="2.5" />
        {type === 'MULTI_LINE' && <polyline points="4,20 16,26 28,10 40,18 60,8" fill="none" stroke="#f59e0b" strokeWidth="2" />}
        </svg>
      );
    case 'AREA':
    case 'STACKED_AREA':
      return (
        <svg {...common}><polygon points="4,32 4,20 16,10 28,18 40,4 60,14 60,32" fill={previewColor} opacity="0.5" /><polyline points="4,20 16,10 28,18 40,4 60,14" fill="none" stroke={previewColor} strokeWidth="2" /></svg>
      );
    case 'PIE':
    case 'DONUT':
      return (
        <svg {...common}>
          <circle cx="32" cy="18" r="14" fill={previewColor2} />
          <path d="M32 18 L32 4 A14 14 0 0 1 44 24 Z" fill={previewColor} />
          {type === 'DONUT' && <circle cx="32" cy="18" r="6" fill="#fff" />}
        </svg>
      );
    case 'SCATTER':
      return (
        <svg {...common}>{[[8,26],[16,12],[22,20],[30,8],[38,18],[46,6],[54,22]].map(([x,y],i) => <circle key={i} cx={x} cy={y} r="2.5" fill={previewColor} />)}</svg>
      );
    case 'HEATMAP':
      return (
        <svg {...common}>{Array.from({ length: 4 }).map((_, r) => Array.from({ length: 6 }).map((_, c) => <rect key={`${r}-${c}`} x={4 + c * 9} y={2 + r * 8} width="7" height="6" fill={previewColor} opacity={0.15 + ((r + c) % 5) * 0.16} />))}</svg>
      );
    case 'RADAR':
      return (
        <svg {...common}><polygon points="32,4 46,14 40,30 24,30 18,14" fill="none" stroke="#cbd5e1" strokeWidth="1" /><polygon points="32,8 40,16 36,26 28,26 24,16" fill={previewColor} opacity="0.5" stroke={previewColor} strokeWidth="1.5" /></svg>
      );
    case 'TABLE':
      return (
        <svg {...common}>{[4, 12, 20, 28].map((y) => <rect key={y} x="4" y={y} width="56" height="6" fill={y === 4 ? previewColor : previewColor2} opacity={y === 4 ? 1 : 0.5} />)}</svg>
      );
    case 'KPI':
    default:
      return (
        <svg {...common}><text x="32" y="24" fontSize="18" fontWeight="900" fill={previewColor} textAnchor="middle">92%</text></svg>
      );
  }
}

export const ChartGalleryPicker: React.FC<ChartGalleryPickerProps> = ({ value, recommended, onChange, language, options }) => {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-64 overflow-y-auto p-0.5">
      {options.map((ct) => {
        const meta = NAME[ct];
        const isSelected = value === ct;
        const isRecommended = ct === recommended;
        return (
          <button
            key={ct}
            type="button"
            onClick={() => onChange(ct)}
            className={`relative flex flex-col items-center gap-1 p-2 rounded border text-center cursor-pointer transition-colors ${isSelected ? 'border-indigo-500 bg-indigo-50' : 'border-slate-200 hover:border-slate-300 bg-white'}`}
          >
            {isRecommended && (
              <span className="absolute top-1 end-1 flex items-center gap-0.5 bg-amber-100 text-amber-700 text-[8px] font-bold px-1 py-0.5 rounded">
                <Star className="w-2 h-2 fill-amber-500 text-amber-500" />
              </span>
            )}
            <MiniPreview type={ct} />
            <span className="text-[10px] font-bold text-slate-700">{language === 'ar' ? meta.ar : meta.en}</span>
            <span className="text-[9px] text-slate-400 leading-tight">{language === 'ar' ? meta.descAr : meta.descEn}</span>
          </button>
        );
      })}
    </div>
  );
};

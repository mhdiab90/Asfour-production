import React from 'react';
import { LucideIcon } from 'lucide-react';
import { formatNumber } from '../../utils/formatters';

interface StatCardProps {
  id?: string;
  title: string;
  value: string | number;
  unit?: string;
  subtitle?: string;
  icon?: LucideIcon;
  color?: 'blue' | 'emerald' | 'amber' | 'rose' | 'slate' | 'indigo';
  trend?: {
    value: string;
    isPositive: boolean;
  };
}

export const StatCard: React.FC<StatCardProps> = ({
  id,
  title,
  value,
  unit,
  subtitle,
  icon: Icon,
  color = 'indigo',
  trend,
}) => {
  const colorMap = {
    indigo: {
      borderAccent: 'border-r-4 border-r-indigo-500',
      iconBg: 'bg-indigo-50 text-indigo-600',
      valueColor: 'text-slate-800',
    },
    emerald: {
      borderAccent: 'border-r-4 border-r-emerald-500',
      iconBg: 'bg-emerald-50 text-emerald-600',
      valueColor: 'text-slate-800',
    },
    rose: {
      borderAccent: 'border-r-4 border-r-rose-500',
      iconBg: 'bg-rose-50 text-rose-600',
      valueColor: 'text-slate-800',
    },
    amber: {
      borderAccent: 'border-r-4 border-r-amber-500',
      iconBg: 'bg-amber-50 text-amber-600',
      valueColor: 'text-slate-800',
    },
    blue: {
      borderAccent: 'border-r-4 border-r-blue-500',
      iconBg: 'bg-blue-50 text-blue-600',
      valueColor: 'text-slate-800',
    },
    slate: {
      borderAccent: 'border-r-4 border-r-slate-500',
      iconBg: 'bg-slate-100 text-slate-700',
      valueColor: 'text-slate-800',
    },
  };

  const scheme = colorMap[color] || colorMap.indigo;

  return (
    <div
      id={id}
      className={`bg-white p-5 border border-slate-200 ${scheme.borderAccent} shadow-xs rounded-none transition-all duration-150 relative overflow-hidden`}
    >
      <div className="flex items-center justify-between gap-3 mb-1">
        <p className="text-xs text-slate-500 font-bold uppercase tracking-wider">{title}</p>
        {Icon && (
          <div className={`w-8 h-8 rounded-sm flex items-center justify-center ${scheme.iconBg} shrink-0`}>
            <Icon className="w-4 h-4" />
          </div>
        )}
      </div>

      <div className="flex items-baseline gap-1.5 mt-1">
        <p className={`text-2xl font-black ${scheme.valueColor} tracking-tight font-mono`}>
          {typeof value === 'number' ? formatNumber(value) : (value ?? '')}
        </p>
        {unit && <span className="text-xs font-semibold text-slate-500">{unit}</span>}
      </div>

      {(subtitle || trend) && (
        <div className="mt-2 flex items-center justify-between text-[11px] text-slate-500">
          {subtitle && <span>{subtitle}</span>}
          {trend && (
            <div
              className={`flex items-center font-bold text-[10px] ${
                trend.isPositive ? 'text-emerald-600' : 'text-rose-600'
              }`}
            >
              <span className="ml-1">{trend.isPositive ? '▲' : '▼'}</span>
              <span>{trend.value}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

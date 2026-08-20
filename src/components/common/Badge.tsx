import React from 'react';

interface BadgeProps {
  children: React.ReactNode;
  variant?: 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'indigo' | 'amber';
  size?: 'sm' | 'md';
  className?: string;
}

export const Badge: React.FC<BadgeProps> = ({
  children,
  variant = 'neutral',
  size = 'sm',
  className = '',
}) => {
  const variantStyles = {
    success: 'bg-emerald-100 text-emerald-700 border-emerald-200 font-bold',
    warning: 'bg-amber-100 text-amber-800 border-amber-200 font-bold',
    danger: 'bg-rose-100 text-rose-700 border-rose-200 font-bold',
    info: 'bg-sky-100 text-sky-700 border-sky-200 font-bold',
    indigo: 'bg-indigo-100 text-indigo-700 border-indigo-200 font-bold',
    amber: 'bg-orange-100 text-orange-800 border-orange-200 font-bold',
    neutral: 'bg-slate-100 text-slate-700 border-slate-200 font-medium',
  };

  const sizeStyles = {
    sm: 'px-2 py-0.5 text-[10px] rounded-full',
    md: 'px-3 py-1 text-xs rounded-full',
  };

  return (
    <span
      className={`inline-flex items-center gap-1 border whitespace-nowrap leading-none ${variantStyles[variant]} ${sizeStyles[size]} ${className}`}
    >
      {children}
    </span>
  );
};

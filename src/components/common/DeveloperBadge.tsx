/**
 * Developer Badge & System Creator Identity Component
 * Official recognition: "Developed by MHDIAB"
 * Uses original developer image (/branding/developer-original.png) with proportional scaling.
 * Rendered in About / حول النظام, System Information, and subtle login screen credit.
 */
import React, { useState } from 'react';
import { Github, Terminal } from 'lucide-react';
import { useBranding } from '../../context/BrandingContext';

export type DeveloperBadgeVariant = 
  | 'compact'      // Tiny inline footer pill
  | 'login'        // Subtle elegant credit on login page
  | 'about'        // Full detailed developer card in About modal
  | 'card'         // Info panel card with stats
  | 'avatar-only'; // Just the avatar icon

interface DeveloperBadgeProps {
  variant?: DeveloperBadgeVariant;
  className?: string;
  onClick?: () => void;
  customSrc?: string;
}

export const ORIGINAL_DEVELOPER_SRC = '/branding/developer-original.png';

export const DeveloperBadge: React.FC<DeveloperBadgeProps> = ({
  variant = 'compact',
  className = '',
  onClick,
  customSrc,
}) => {
  const [imageError, setImageError] = useState(false);

  let brandingDevSrc = ORIGINAL_DEVELOPER_SRC;
  try {
    const branding = useBranding();
    if (branding?.developerImageSrc) {
      brandingDevSrc = branding.developerImageSrc;
    }
  } catch {
    // If rendered outside provider
  }

  const activeSrc = customSrc || brandingDevSrc;

  // Fallback vector avatar
  const renderFallbackVector = (size: number) => {
    return (
      <svg
        viewBox="0 0 100 100"
        width={size}
        height={size}
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="shrink-0"
      >
        <circle cx="50" cy="50" r="48" fill="#0B132B" stroke="#64748B" strokeWidth="2" />
        <path d="M20 95 C20 70, 35 66, 50 66 C65 66, 80 70, 80 95 Z" fill="#1E3A8A" />
        <ellipse cx="50" cy="44" rx="17" ry="20" fill="#E2B295" />
        <path d="M33 40 C33 22, 67 22, 67 40 C67 30, 60 25, 50 25 C40 25, 33 30, 33 40 Z" fill="#1E293B" />
        <circle cx="43" cy="41" r="2" fill="#0F172A" />
        <circle cx="57" cy="41" r="2" fill="#0F172A" />
      </svg>
    );
  };

  const renderDeveloperAvatar = (size: number) => {
    return (
      <div 
        className="relative rounded-full shrink-0 overflow-hidden shadow-md flex items-center justify-center bg-slate-900 border-2 border-slate-500/80"
        style={{ width: `${size}px`, height: `${size}px` }}
      >
        {!imageError ? (
          <img
            src={activeSrc}
            alt="MHDIAB - Lead Developer"
            className="w-full h-full object-cover shrink-0"
            onError={() => setImageError(true)}
          />
        ) : (
          renderFallbackVector(size)
        )}
      </div>
    );
  };

  // 1. Avatar Only
  if (variant === 'avatar-only') {
    return renderDeveloperAvatar(36);
  }

  // 2. Compact Footer Pill
  if (variant === 'compact') {
    return (
      <button
        type="button"
        onClick={onClick}
        className={`inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-slate-800/80 hover:bg-slate-800 border border-slate-700 text-slate-300 hover:text-white transition-all text-xs cursor-pointer select-none group ${className}`}
        title="Developer Info / معلومات المطور"
      >
        {renderDeveloperAvatar(20)}
        <span className="text-[11px] font-medium text-slate-400 group-hover:text-slate-200">
          Developed by <span className="font-bold text-amber-400">MHDIAB</span>
        </span>
      </button>
    );
  }

  // 3. Login Page Subtle Credit
  if (variant === 'login') {
    return (
      <div className={`flex items-center justify-center gap-2 text-xs text-slate-400 select-none ${className}`}>
        {renderDeveloperAvatar(24)}
        <span>
          Developed by <span className="text-slate-200 font-bold">MHDIAB</span>
        </span>
      </div>
    );
  }

  // 4. About Modal Detailed Card (Prominent & Respectful)
  if (variant === 'about') {
    return (
      <div className={`p-4 rounded-2xl bg-gradient-to-br from-slate-900 via-slate-900 to-indigo-950 border border-indigo-900/40 text-white shadow-xl ${className}`}>
        <div className="flex items-start gap-4">
          {renderDeveloperAvatar(64)}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h4 className="text-base font-bold text-white tracking-wide">
                MHDIAB
              </h4>
              <span className="px-2 py-0.5 rounded-md bg-indigo-500/20 text-indigo-300 text-[10px] font-mono font-bold border border-indigo-500/30">
                System Architect &amp; Lead Engineer
              </span>
            </div>
            <p className="text-xs text-slate-300 mt-1 leading-relaxed">
              تطوير وهندسة منظومة إدارة مصنع عصفور للتعدين والحراريات (ERP)
            </p>
            <div className="mt-3 flex items-center gap-3 text-xs text-slate-300 flex-wrap">
              <a
                href="https://github.com/mhdiab90/Asfour-production"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white border border-slate-700 transition"
              >
                <Github className="w-3.5 h-3.5 text-slate-400" />
                <span className="font-mono text-[11px]">mhdiab90/Asfour-production</span>
              </a>
              <span className="text-[11px] text-slate-400 flex items-center gap-1 font-mono">
                <Terminal className="w-3 h-3 text-emerald-400" />
                <span>Production v3.2</span>
              </span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // 5. Card Variant
  return (
    <div className={`flex items-center gap-3 p-3 rounded-xl bg-slate-900 border border-slate-800 text-slate-200 ${className}`}>
      {renderDeveloperAvatar(36)}
      <div className="flex flex-col text-right">
        <span className="text-xs font-bold text-white">MHDIAB</span>
        <span className="text-[10px] text-slate-400">نظام إدارة الإنتاج والحراريات</span>
      </div>
    </div>
  );
};

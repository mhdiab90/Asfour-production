/**
 * ASFOUR Company Official Logo Component
 * Uses the exact uploaded official ASFOUR logo image (/branding/asfour-logo-original.png).
 * Preserves original dimensions, aspect ratio, typography, colors, and background.
 * Supports multiple responsive variants: login, sidebar, header, dashboard, report-print, white, icon-only.
 */
import React, { useState } from 'react';
import { useBranding } from '../../context/BrandingContext';

export type AsfourLogoVariant = 
  | 'full'          // Standard full logo with text
  | 'compact'       // Inline horizontal logo
  | 'icon'          // Geometric icon only
  | 'login'         // Prominent large login branding
  | 'sidebar'       // Dark-mode optimized sidebar header
  | 'header'        // Top bar compact branding
  | 'dashboard'     // Dashboard hero badge
  | 'print'         // High-contrast print / report logo
  | 'white';        // Monochrome inverted for dark surfaces

interface AsfourLogoProps {
  variant?: AsfourLogoVariant;
  className?: string;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl';
  showSubtitle?: boolean;
  subtitleLang?: 'ar' | 'en' | 'bilingual';
  animated?: boolean;
  customSrc?: string;
}

export const ORIGINAL_LOGO_SRC = '/branding/asfour-logo-original.png';

export const AsfourLogo: React.FC<AsfourLogoProps> = ({
  variant = 'full',
  className = '',
  size = 'md',
  showSubtitle = true,
  subtitleLang = 'bilingual',
  animated = false,
  customSrc,
}) => {
  const [imageError, setImageError] = useState(false);
  
  let brandingLogoSrc = ORIGINAL_LOGO_SRC;
  try {
    const branding = useBranding();
    if (branding?.companyLogoSrc) {
      brandingLogoSrc = branding.companyLogoSrc;
    }
  } catch {
    // If rendered outside provider
  }

  const activeSrc = customSrc || brandingLogoSrc;

  // Dimensions helper
  const getDimensions = () => {
    switch (size) {
      case 'xs': return { height: 'h-6', iconSize: 24, text: 'text-xs', sub: 'text-[9px]' };
      case 'sm': return { height: 'h-8', iconSize: 32, text: 'text-sm', sub: 'text-[10px]' };
      case 'md': return { height: 'h-10', iconSize: 40, text: 'text-base', sub: 'text-[11px]' };
      case 'lg': return { height: 'h-14', iconSize: 56, text: 'text-xl', sub: 'text-xs' };
      case 'xl': return { height: 'h-20', iconSize: 80, text: 'text-2xl', sub: 'text-sm' };
      case '2xl': return { height: 'h-28', iconSize: 112, text: 'text-3xl', sub: 'text-base' };
      default: return { height: 'h-10', iconSize: 40, text: 'text-base', sub: 'text-[11px]' };
    }
  };

  const dim = getDimensions();

  // Vector Graphic of the ASFOUR Geometric Apex Icon as resilient fallback
  const renderApexVector = (iconSize: number, isDark = false, isMonochrome = false) => {
    const orangeGrad = isMonochrome ? '#FFFFFF' : '#EA580C';
    const navyGrad = isMonochrome ? '#CBD5E1' : (isDark ? '#38BDF8' : '#1E3A8A');

    return (
      <svg
        width={iconSize}
        height={iconSize}
        viewBox="0 0 100 100"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className={`shrink-0 ${animated ? 'transition-transform duration-300 hover:scale-105' : ''}`}
        aria-label="ASFOUR Company Logo"
      >
        <defs>
          <linearGradient id="asfourOrangeGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#FB923C" />
            <stop offset="60%" stopColor="#EA580C" />
            <stop offset="100%" stopColor="#C2410C" />
          </linearGradient>
          <linearGradient id="asfourNavyGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#1E40AF" />
            <stop offset="70%" stopColor="#1E3A8A" />
            <stop offset="100%" stopColor="#0F172A" />
          </linearGradient>
        </defs>

        <polygon points="50,6 68,36 50,30 32,36" fill={isMonochrome ? '#FFFFFF' : 'url(#asfourOrangeGrad)'} />
        <polygon points="50,28 88,48 76,56 50,42 24,56 12,48" fill={navyGrad} />
        <polygon points="26,58 42,46 36,78 18,92" fill={orangeGrad} />
        <polygon points="74,58 58,46 64,78 82,92" fill={orangeGrad} />
        <polygon points="50,45 57,55 50,66 43,55" fill={isMonochrome ? '#E2E8F0' : (isDark ? '#0F172A' : '#FFFFFF')} stroke={isMonochrome ? '#FFFFFF' : (isDark ? '#38BDF8' : '#1E3A8A')} strokeWidth="2" />
      </svg>
    );
  };

  // Original Image renderer with proportional sizing and zero distortion
  const renderOriginalImage = (customHeightClass: string, imgClassName = '', lightContainer = false) => {
    if (imageError) {
      return renderApexVector(dim.iconSize, !lightContainer);
    }

    const imgElement = (
      <img
        src={activeSrc}
        alt="ASFOUR For Mining & Refractories"
        className={`max-h-full max-w-full w-auto h-auto object-contain shrink-0 ${imgClassName}`}
        onError={() => setImageError(true)}
      />
    );

    if (lightContainer) {
      return (
        <div className={`bg-white rounded-xl p-1.5 shadow-sm inline-flex items-center justify-center ${customHeightClass}`}>
          {imgElement}
        </div>
      );
    }

    return (
      <div className={`inline-flex items-center justify-center ${customHeightClass}`}>
        {imgElement}
      </div>
    );
  };

  // 1. Icon Only
  if (variant === 'icon') {
    return (
      <div className={`inline-flex items-center justify-center ${className}`}>
        {renderOriginalImage(dim.height, 'max-w-[40px]')}
      </div>
    );
  }

  // 2. Login Page Variant (Magnificent corporate layout with original brand image)
  if (variant === 'login') {
    return (
      <div className={`flex flex-col items-center text-center select-none ${className}`}>
        <div className="relative mb-3 p-3 rounded-2xl bg-white border border-slate-200 shadow-2xl inline-flex items-center justify-center">
          <img
            src={activeSrc}
            alt="ASFOUR For Mining & Refractories"
            className="h-20 sm:h-24 w-auto object-contain shrink-0"
            onError={(e) => {
              e.currentTarget.style.display = 'none';
              setImageError(true);
            }}
          />
          {imageError && renderApexVector(72, false)}
        </div>

        <div className="space-y-1">
          <h1 className="text-2xl sm:text-3xl font-black text-white tracking-wider uppercase">
            <span className="text-white">ASFOUR</span>
          </h1>
          <p className="text-xs sm:text-sm font-bold text-amber-400 tracking-wider uppercase">
            For Mining &amp; Refractories
          </p>
          <div className="flex items-center justify-center gap-2 pt-1">
            <span className="h-px w-6 bg-slate-700" />
            <span className="text-xs font-semibold text-slate-300">
              شركة عصفور للتعدين والحراريات
            </span>
            <span className="h-px w-6 bg-slate-700" />
          </div>
        </div>
      </div>
    );
  }

  // 3. Sidebar Variant (Dark slate container with crisp white badge)
  if (variant === 'sidebar') {
    return (
      <div className={`flex items-center gap-3 select-none ${className}`}>
        <div className="p-1 rounded-lg bg-white border border-slate-200 shadow-sm shrink-0 flex items-center justify-center h-11 w-11">
          <img
            src={activeSrc}
            alt="ASFOUR Logo"
            className="h-9 w-9 object-contain"
            onError={(e) => {
              e.currentTarget.style.display = 'none';
              setImageError(true);
            }}
          />
          {imageError && renderApexVector(28, false)}
        </div>
        <div className="flex flex-col leading-tight min-w-0">
          <span className="text-sm font-black text-white tracking-wide uppercase truncate">
            ASFOUR
          </span>
          <span className="text-[10px] font-bold text-amber-400 tracking-wider uppercase truncate">
            Refractories ERP
          </span>
          <span className="text-[9px] text-slate-400 truncate">
            عصفور للحراريات
          </span>
        </div>
      </div>
    );
  }

  // 4. Header Topbar Variant
  if (variant === 'header') {
    return (
      <div className={`flex items-center gap-2.5 select-none ${className}`}>
        <div className="p-1 rounded-lg bg-white border border-slate-200 shadow-xs shrink-0 flex items-center justify-center h-9 w-9">
          <img
            src={activeSrc}
            alt="ASFOUR"
            className="h-7 w-7 object-contain"
            onError={(e) => {
              e.currentTarget.style.display = 'none';
              setImageError(true);
            }}
          />
          {imageError && renderApexVector(24, false)}
        </div>
        <div className="hidden sm:flex flex-col leading-none">
          <span className="text-sm font-black text-slate-900 tracking-wide uppercase">
            ASFOUR
          </span>
          <span className="text-[9px] font-semibold text-slate-500 uppercase tracking-wider">
            Mining &amp; Refractories
          </span>
        </div>
      </div>
    );
  }

  // 5. Print / Report Variant (Clean high contrast for printable documents)
  if (variant === 'print') {
    return (
      <div className={`flex items-center justify-between p-3 border-b-2 border-slate-900 bg-white text-slate-900 select-none ${className}`}>
        <div className="flex items-center gap-3.5">
          <div className="h-14 w-auto flex items-center justify-center shrink-0">
            <img
              src={activeSrc}
              alt="ASFOUR Company Logo"
              className="h-12 w-auto object-contain"
              onError={(e) => {
                e.currentTarget.style.display = 'none';
                setImageError(true);
              }}
            />
            {imageError && renderApexVector(44, false)}
          </div>
          <div>
            <h2 className="text-xl font-black tracking-wider text-slate-900 uppercase">
              ASFOUR FOR MINING &amp; REFRACTORIES
            </h2>
            <p className="text-xs font-bold text-slate-700">
              شركة عصفور للتعدين والحراريات &bull; قطاع إدارة وتخطيط الإنتاج
            </p>
          </div>
        </div>
        <div className="text-left font-mono text-[10px] text-slate-600">
          <p className="font-bold text-slate-800">ISO 9001:2015 CERTIFIED</p>
          <p>ASFOUR PRODUCTION ERP SYSTEM</p>
        </div>
      </div>
    );
  }

  // 6. Compact Horizontal Variant
  if (variant === 'compact') {
    return (
      <div className={`flex items-center gap-2.5 select-none ${className}`}>
        <div className="p-1 rounded-lg bg-white border border-slate-200 shadow-xs shrink-0 flex items-center justify-center h-8 w-8">
          <img
            src={activeSrc}
            alt="ASFOUR"
            className="h-6 w-6 object-contain"
            onError={(e) => {
              e.currentTarget.style.display = 'none';
              setImageError(true);
            }}
          />
          {imageError && renderApexVector(22, false)}
        </div>
        <div className="flex flex-col leading-none">
          <span className="text-xs font-black text-slate-900 uppercase">ASFOUR</span>
          <span className="text-[9px] text-slate-500 font-medium">Refractories</span>
        </div>
      </div>
    );
  }

  // 7. Standard Full Logo (Default)
  return (
    <div className={`flex items-center gap-3 select-none ${className}`}>
      <div className="p-1 rounded-xl bg-white border border-slate-200/80 shadow-xs shrink-0 flex items-center justify-center">
        <img
          src={activeSrc}
          alt="ASFOUR Logo"
          className="h-10 w-auto object-contain"
          onError={(e) => {
            e.currentTarget.style.display = 'none';
            setImageError(true);
          }}
        />
        {imageError && renderApexVector(36, false)}
      </div>
      <div className="flex flex-col leading-tight">
        <span className={`font-black text-slate-900 tracking-wider uppercase ${dim.text}`}>
          ASFOUR
        </span>
        {showSubtitle && (
          <>
            <span className={`font-bold text-orange-600 uppercase tracking-wider ${dim.sub}`}>
              For Mining &amp; Refractories
            </span>
            {(subtitleLang === 'ar' || subtitleLang === 'bilingual') && (
              <span className="text-[10px] text-slate-500 font-medium">
                شركة عصفور للتعدين والحراريات
              </span>
            )}
          </>
        )}
      </div>
    </div>
  );
};

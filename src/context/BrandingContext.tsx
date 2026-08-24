/**
 * ASFOUR ERP - Global Branding Context & State
 * 
 * Provides static company logo and developer image assets across the application.
 * Source of Truth:
 * - Company Logo: `/branding/company-logo.png`
 * - Developer Image: `/branding/developer.jpeg`
 */
import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import { BrandingSettings } from '../types';
import { 
  DEFAULT_BRANDING, 
  STATIC_COMPANY_LOGO_PATH,
  STATIC_DEVELOPER_IMAGE_PATH,
  getBrandingSettings, 
  subscribeBrandingSettings,
  ensureStaticBrandingConfig
} from '../services/brandingService';

export const ORIGINAL_FALLBACK_LOGO = STATIC_COMPANY_LOGO_PATH;
export const ORIGINAL_FALLBACK_DEV = STATIC_DEVELOPER_IMAGE_PATH;

interface BrandingContextType {
  branding: BrandingSettings;
  isLoading: boolean;
  isSaving: boolean;
  error: string | null;
  companyLogoSrc: string;
  developerImageSrc: string;
  hasCustomLogo: boolean;
  hasCustomDeveloperImage: boolean;
  refreshBranding: () => Promise<void>;
}

const BrandingContext = createContext<BrandingContextType | undefined>(undefined);

export const BrandingProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [branding, setBranding] = useState<BrandingSettings>(DEFAULT_BRANDING);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Sync static asset configuration to Firestore & real-time subscription
  useEffect(() => {
    setIsLoading(true);
    // Ensure Firestore document exists with STATIC_ASSET mode
    ensureStaticBrandingConfig().catch((err) => {
      console.warn('Non-blocking static branding sync notice:', err);
    });

    const unsubscribe = subscribeBrandingSettings(
      (settings) => {
        setBranding(settings);
        setIsLoading(false);
      },
      (err) => {
        console.warn('Branding context subscription notice:', err);
        setIsLoading(false);
      }
    );
    return () => unsubscribe();
  }, []);

  const refreshBranding = useCallback(async () => {
    try {
      setIsLoading(true);
      const settings = await getBrandingSettings();
      setBranding(settings);
      setError(null);
    } catch (err: any) {
      setError(err?.message || 'Failed to reload branding');
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Static assets are the single source of truth
  const companyLogoSrc = STATIC_COMPANY_LOGO_PATH;
  const developerImageSrc = STATIC_DEVELOPER_IMAGE_PATH;
  const hasCustomLogo = true;
  const hasCustomDeveloperImage = true;

  const value = useMemo(
    () => ({
      branding,
      isLoading,
      isSaving: false,
      error,
      companyLogoSrc,
      developerImageSrc,
      hasCustomLogo,
      hasCustomDeveloperImage,
      refreshBranding,
    }),
    [
      branding,
      isLoading,
      error,
      companyLogoSrc,
      developerImageSrc,
      hasCustomLogo,
      hasCustomDeveloperImage,
      refreshBranding,
    ]
  );

  return <BrandingContext.Provider value={value}>{children}</BrandingContext.Provider>;
};

export const useBranding = (): BrandingContextType => {
  const context = useContext(BrandingContext);
  if (!context) {
    throw new Error('useBranding must be used within a BrandingProvider');
  }
  return context;
};

/**
 * ASFOUR ERP - Global Branding Context & Real-time State
 * Provides live company logo, developer image, and upload/reset methods across the application.
 */
import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import { BrandingSettings } from '../types';
import { 
  DEFAULT_BRANDING, 
  getBrandingSettings, 
  subscribeBrandingSettings, 
  uploadAndReplaceBrandingAsset, 
  deleteBrandingAsset 
} from '../services/brandingService';

export const ORIGINAL_FALLBACK_LOGO = '/branding/asfour-logo-original.png';
export const ORIGINAL_FALLBACK_DEV = '/branding/developer-original.png';

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
  uploadAndSaveLogo: (file: File, onProgress?: (percent: number) => void) => Promise<void>;
  uploadAndSaveDeveloperImage: (file: File, onProgress?: (percent: number) => void) => Promise<void>;
  deleteLogo: () => Promise<void>;
  deleteDeveloperImage: () => Promise<void>;
}

const BrandingContext = createContext<BrandingContextType | undefined>(undefined);

export const BrandingProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [branding, setBranding] = useState<BrandingSettings>(DEFAULT_BRANDING);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Real-time Firestore subscription
  useEffect(() => {
    setIsLoading(true);
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

  const uploadAndSaveLogo = useCallback(async (file: File, onProgress?: (percent: number) => void) => {
    setIsSaving(true);
    setError(null);
    try {
      await uploadAndReplaceBrandingAsset(file, 'company_logo', branding.companyLogoPath, onProgress);
      await refreshBranding();
    } catch (err: any) {
      setError(err?.message || 'Failed to upload company logo');
      throw err;
    } finally {
      setIsSaving(false);
    }
  }, [branding.companyLogoPath, refreshBranding]);

  const uploadAndSaveDeveloperImage = useCallback(async (file: File, onProgress?: (percent: number) => void) => {
    setIsSaving(true);
    setError(null);
    try {
      await uploadAndReplaceBrandingAsset(file, 'developer', branding.developerImagePath, onProgress);
      await refreshBranding();
    } catch (err: any) {
      setError(err?.message || 'Failed to upload developer image');
      throw err;
    } finally {
      setIsSaving(false);
    }
  }, [branding.developerImagePath, refreshBranding]);

  const deleteLogo = useCallback(async () => {
    setIsSaving(true);
    setError(null);
    try {
      await deleteBrandingAsset('company_logo', branding.companyLogoPath);
      await refreshBranding();
    } catch (err: any) {
      setError(err?.message || 'Failed to delete company logo');
      throw err;
    } finally {
      setIsSaving(false);
    }
  }, [branding.companyLogoPath, refreshBranding]);

  const deleteDeveloperImage = useCallback(async () => {
    setIsSaving(true);
    setError(null);
    try {
      await deleteBrandingAsset('developer', branding.developerImagePath);
      await refreshBranding();
    } catch (err: any) {
      setError(err?.message || 'Failed to delete developer image');
      throw err;
    } finally {
      setIsSaving(false);
    }
  }, [branding.developerImagePath, refreshBranding]);

  const companyLogoSrc = branding.companyLogoUrl || ORIGINAL_FALLBACK_LOGO;
  const developerImageSrc = branding.developerImageUrl || ORIGINAL_FALLBACK_DEV;
  const hasCustomLogo = Boolean(branding.companyLogoUrl);
  const hasCustomDeveloperImage = Boolean(branding.developerImageUrl);

  const value = useMemo(
    () => ({
      branding,
      isLoading,
      isSaving,
      error,
      companyLogoSrc,
      developerImageSrc,
      hasCustomLogo,
      hasCustomDeveloperImage,
      refreshBranding,
      uploadAndSaveLogo,
      uploadAndSaveDeveloperImage,
      deleteLogo,
      deleteDeveloperImage,
    }),
    [
      branding,
      isLoading,
      isSaving,
      error,
      companyLogoSrc,
      developerImageSrc,
      hasCustomLogo,
      hasCustomDeveloperImage,
      refreshBranding,
      uploadAndSaveLogo,
      uploadAndSaveDeveloperImage,
      deleteLogo,
      deleteDeveloperImage,
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

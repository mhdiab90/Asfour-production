/**
 * ASFOUR ERP - Static Asset Branding Service
 * 
 * Manages Company Logo & Developer Image visual identity using 100% exact original
 * static assets located in `/public/branding/`.
 * 
 * Sources of Truth:
 * - Company Logo: `/branding/company-logo.png`
 * - Developer Image: `/branding/developer.jpeg`
 * 
 * Mode: STATIC_ASSET (Cloudinary & Firebase Storage branding upload paths are completely removed)
 * Firestore: `system_settings/branding` maintains metadata and storage mode with zero undefined values.
 */
import { doc, getDoc, setDoc, onSnapshot, serverTimestamp } from 'firebase/firestore';
import { db, auth, handleFirestoreError, OperationType } from '../config/firebase';
import { BrandingSettings } from '../types';
import { logAuditAction } from './auditService';

export const BRANDING_DOC_PATH = 'system_settings/branding';

// Exact Static Asset Paths (Single Source of Truth)
export const STATIC_COMPANY_LOGO_PATH = '/branding/company-logo.png';
export const STATIC_DEVELOPER_IMAGE_PATH = '/branding/developer.jpeg';

export const DEFAULT_BRANDING: BrandingSettings = {
  brandingStorageMode: 'STATIC_ASSET',
  companyLogoPath: STATIC_COMPANY_LOGO_PATH,
  developerImagePath: STATIC_DEVELOPER_IMAGE_PATH,
  companyLogoUrl: STATIC_COMPANY_LOGO_PATH,
  developerImageUrl: STATIC_DEVELOPER_IMAGE_PATH,
  companyLogoFileName: 'company-logo.png',
  developerImageFileName: 'developer.jpeg',
  companyLogoContentType: 'image/png',
  developerImageContentType: 'image/jpeg',
  companyLogoUpdatedAt: null,
  companyLogoUpdatedByUid: null,
  developerImageUpdatedAt: null,
  developerImageUpdatedByUid: null,
};

/**
 * Sanitize metadata object before writing to Firestore
 * Removes any undefined values, converts NaN to null
 */
export function sanitizeBrandingPayload(payload: Record<string, any>): Record<string, any> {
  const clean: Record<string, any> = {};
  for (const [key, val] of Object.entries(payload)) {
    if (val === undefined) {
      continue;
    }
    if (typeof val === 'number' && isNaN(val)) {
      clean[key] = null;
    } else {
      clean[key] = val;
    }
  }
  return clean;
}

/**
 * Fetch current branding settings from Firestore
 */
export async function getBrandingSettings(): Promise<BrandingSettings> {
  try {
    const docRef = doc(db, 'system_settings', 'branding');
    const snap = await getDoc(docRef);
    if (snap.exists()) {
      const data = snap.data();
      return {
        id: snap.id,
        ...DEFAULT_BRANDING,
        ...data,
        // Always enforce static asset paths as the active source of truth
        brandingStorageMode: 'STATIC_ASSET',
        companyLogoPath: STATIC_COMPANY_LOGO_PATH,
        developerImagePath: STATIC_DEVELOPER_IMAGE_PATH,
      } as BrandingSettings;
    }
    return DEFAULT_BRANDING;
  } catch (error) {
    console.warn('Could not fetch branding settings from Firestore, using static defaults:', error);
    return DEFAULT_BRANDING;
  }
}

/**
 * Real-time subscription to branding settings from Firestore
 */
export function subscribeBrandingSettings(
  onUpdate: (settings: BrandingSettings) => void,
  onError?: (err: any) => void
): () => void {
  const docRef = doc(db, 'system_settings', 'branding');
  return onSnapshot(
    docRef,
    (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        onUpdate({
          id: snap.id,
          ...DEFAULT_BRANDING,
          ...data,
          brandingStorageMode: 'STATIC_ASSET',
          companyLogoPath: STATIC_COMPANY_LOGO_PATH,
          developerImagePath: STATIC_DEVELOPER_IMAGE_PATH,
        } as BrandingSettings);
      } else {
        onUpdate(DEFAULT_BRANDING);
      }
    },
    (err) => {
      console.warn('Branding subscription notice:', err);
      if (onError) onError(err);
    }
  );
}

/**
 * Ensures the Firestore `system_settings/branding` configuration document contains the
 * required static asset mode and paths, while preserving any historical audit fields.
 */
export async function ensureStaticBrandingConfig(): Promise<void> {
  try {
    const docRef = doc(db, 'system_settings', 'branding');
    const snap = await getDoc(docRef);

    const currentUser = auth.currentUser;
    const updatePayload: Record<string, any> = {
      brandingStorageMode: 'STATIC_ASSET',
      companyLogoPath: STATIC_COMPANY_LOGO_PATH,
      developerImagePath: STATIC_DEVELOPER_IMAGE_PATH,
      companyLogoUrl: STATIC_COMPANY_LOGO_PATH,
      developerImageUrl: STATIC_DEVELOPER_IMAGE_PATH,
      updatedAt: new Date().toISOString(),
      serverUpdatedAt: serverTimestamp(),
      updatedByUid: currentUser?.uid || 'system',
      updatedByEmail: currentUser?.email || 'system@asfour.local',
    };

    const sanitized = sanitizeBrandingPayload(updatePayload);
    await setDoc(docRef, sanitized, { merge: true });

    if (!snap.exists() || snap.data()?.brandingStorageMode !== 'STATIC_ASSET') {
      await logAuditAction(
        'UPDATE',
        'system_settings',
        'branding',
        'Configured static asset mode for company logo and developer image'
      );
    }
  } catch (error) {
    console.warn('Could not synchronize static branding configuration to Firestore:', error);
  }
}

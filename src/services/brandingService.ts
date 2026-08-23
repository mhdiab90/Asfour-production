/**
 * ASFOUR ERP - Manual Branding & Asset Management Service
 * Handles uploading original company logo and developer images to Firebase Storage
 * and saving metadata in Firestore (`system_settings/branding`).
 * Strictly preserves 100% original file fidelity (zero AI re-generation/re-drawing).
 */
import { doc, getDoc, setDoc, onSnapshot, serverTimestamp } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import { db, storage, auth, handleFirestoreError, OperationType } from '../config/firebase';
import { BrandingSettings } from '../types';
import { logAuditAction } from './auditService';

export const BRANDING_DOC_PATH = 'system_settings/branding';
export const ALLOWED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/svg+xml'];
export const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB

export const DEFAULT_BRANDING: BrandingSettings = {
  companyLogoUrl: null,
  companyLogoPath: null,
  companyLogoFileName: null,
  companyLogoContentType: null,
  companyLogoSize: null,
  companyLogoUpdatedAt: null,

  developerImageUrl: null,
  developerImagePath: null,
  developerImageFileName: null,
  developerImageContentType: null,
  developerImageSize: null,
  developerImageUpdatedAt: null,
};

/**
 * Fetch current branding settings from Firestore
 */
export async function getBrandingSettings(): Promise<BrandingSettings> {
  try {
    const docRef = doc(db, 'system_settings', 'branding');
    const snap = await getDoc(docRef);
    if (snap.exists()) {
      return {
        id: snap.id,
        ...DEFAULT_BRANDING,
        ...snap.data(),
      } as BrandingSettings;
    }
    return DEFAULT_BRANDING;
  } catch (error) {
    console.warn('Could not fetch branding settings, using defaults:', error);
    return DEFAULT_BRANDING;
  }
}

/**
 * Real-time subscription to branding settings
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
        onUpdate({
          id: snap.id,
          ...DEFAULT_BRANDING,
          ...snap.data(),
        } as BrandingSettings);
      } else {
        onUpdate(DEFAULT_BRANDING);
      }
    },
    (err) => {
      console.warn('Branding subscription warning:', err);
      if (onError) onError(err);
    }
  );
}

/**
 * Convert file to Base64 data URL for offline fallback or instant local rendering
 */
export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = (err) => reject(err);
    reader.readAsDataURL(file);
  });
}

/**
 * Upload manual branding file to Firebase Storage with full error resilience
 */
export async function uploadBrandingFile(
  file: File,
  type: 'company_logo' | 'developer'
): Promise<{
  downloadUrl: string;
  storagePath: string;
  fileName: string;
  contentType: string;
  size: number;
}> {
  if (!file) {
    throw new Error('No file provided for upload');
  }

  // 1. Validation
  if (!ALLOWED_IMAGE_TYPES.includes(file.type.toLowerCase())) {
    throw new Error(`Unsupported file format (${file.type}). Allowed formats: PNG, JPEG, WEBP, SVG.`);
  }

  if (file.size > MAX_FILE_SIZE_BYTES) {
    throw new Error(`File size (${(file.size / (1024 * 1024)).toFixed(1)}MB) exceeds maximum limit of 10MB.`);
  }

  const sanitizedFileName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const timestamp = Date.now();
  const folder = type === 'company_logo' ? 'branding/company-logo' : 'branding/developer';
  const storagePath = `${folder}/${timestamp}_${sanitizedFileName}`;

  try {
    const storageRef = ref(storage, storagePath);
    
    // Upload original untouched bytes with explicit metadata
    const metadata = {
      contentType: file.type,
      customMetadata: {
        originalName: file.name,
        uploadedAt: new Date().toISOString(),
        uploadedBy: auth.currentUser?.email || 'Admin',
        type,
      },
    };

    const snapshot = await uploadBytes(storageRef, file, metadata);
    const downloadUrl = await getDownloadURL(snapshot.ref);

    return {
      downloadUrl,
      storagePath,
      fileName: file.name,
      contentType: file.type,
      size: file.size,
    };
  } catch (error: any) {
    console.warn('Firebase Storage direct upload notice:', error);
    // If Storage bucket is blocked or offline, fallback to data URL to guarantee user experience
    const fallbackDataUrl = await fileToDataUrl(file);
    return {
      downloadUrl: fallbackDataUrl,
      storagePath: `inline://${storagePath}`,
      fileName: file.name,
      contentType: file.type,
      size: file.size,
    };
  }
}

/**
 * Save / Update branding metadata in Firestore
 */
export async function saveBrandingSettings(
  updates: Partial<BrandingSettings>,
  user?: { uid: string; email: string }
): Promise<void> {
  const currentUser = auth.currentUser || user;
  const docRef = doc(db, 'system_settings', 'branding');

  const payload: Record<string, any> = {
    ...updates,
    updatedAt: new Date().toISOString(),
    serverUpdatedAt: serverTimestamp(),
    updatedByUid: currentUser?.uid || 'admin',
    updatedByEmail: currentUser?.email || 'admin@asfour.local',
  };

  try {
    await setDoc(docRef, payload, { merge: true });

    await logAuditAction(
      'UPDATE',
      'system_settings',
      'branding',
      `Manual branding update: ${Object.keys(updates).join(', ')}`
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, 'system_settings/branding');
  }
}

/**
 * Delete / Reset branding asset and clear Firestore metadata
 */
export async function deleteBrandingAsset(
  type: 'company_logo' | 'developer',
  currentPath?: string | null
): Promise<void> {
  // 1. Delete from Firebase Storage if it was an actual storage path
  if (currentPath && !currentPath.startsWith('inline://') && !currentPath.startsWith('data:')) {
    try {
      const storageRef = ref(storage, currentPath);
      await deleteObject(storageRef);
    } catch (storageErr) {
      console.warn('Could not delete storage object:', storageErr);
    }
  }

  // 2. Clear fields in Firestore
  const clearPayload: Partial<BrandingSettings> = type === 'company_logo' 
    ? {
        companyLogoUrl: null,
        companyLogoPath: null,
        companyLogoFileName: null,
        companyLogoContentType: null,
        companyLogoSize: null,
        companyLogoUpdatedAt: new Date().toISOString(),
      }
    : {
        developerImageUrl: null,
        developerImagePath: null,
        developerImageFileName: null,
        developerImageContentType: null,
        developerImageSize: null,
        developerImageUpdatedAt: new Date().toISOString(),
      };

  await saveBrandingSettings(clearPayload);

  await logAuditAction(
    'UPDATE',
    'system_settings',
    'branding',
    `Removed manual branding asset for ${type}`
  );
}

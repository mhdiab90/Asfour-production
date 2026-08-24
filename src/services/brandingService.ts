/**
 * ASFOUR ERP - Manual Branding & Asset Management Service
 * Handles uploading untouched original Company Logo & Developer Image to Firebase Storage
 * and persisting metadata in Firestore (`system_settings/branding`).
 * 
 * Strict Guidelines:
 * - 100% original file fidelity (zero AI re-generation, zero modifications, zero compressions)
 * - Uses uploadBytesResumable for real progress tracking (0-100%)
 * - 30-second failsafe timeout with cancellation
 * - Explicit error mapping for all Firebase Storage error codes
 * - Sanitized Firestore metadata writes (never saves undefined)
 * - Safe replacement: new file is uploaded & metadata saved before removing old file
 */
import { doc, getDoc, setDoc, onSnapshot, serverTimestamp } from 'firebase/firestore';
import { ref, uploadBytesResumable, getDownloadURL, deleteObject } from 'firebase/storage';
import { db, storage, auth, handleFirestoreError, OperationType } from '../config/firebase';
import { BrandingSettings } from '../types';
import { logAuditAction } from './auditService';

export const BRANDING_DOC_PATH = 'system_settings/branding';
export const ALLOWED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'];
export const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5MB limit
export const UPLOAD_TIMEOUT_MS = 30000; // 30 seconds failsafe timeout
export const SECURITY_ADMIN_EMAIL = 'ai.mhdiab90@gmail.com';

export const DEFAULT_BRANDING: BrandingSettings = {
  companyLogoUrl: null,
  companyLogoPath: null,
  companyLogoFileName: null,
  companyLogoContentType: null,
  companyLogoSize: null,
  companyLogoUpdatedAt: null,
  companyLogoUpdatedByUid: null,

  developerImageUrl: null,
  developerImagePath: null,
  developerImageFileName: null,
  developerImageContentType: null,
  developerImageSize: null,
  developerImageUpdatedAt: null,
  developerImageUpdatedByUid: null,
};

export interface BrandingUploadResult {
  downloadUrl: string;
  storagePath: string;
  fileName: string;
  contentType: string;
  size: number;
}

export interface BrandingErrorDetails {
  code: string;
  messageAr: string;
  messageEn: string;
  rawMessage: string;
  timestamp: string;
  fileName?: string;
  fileSize?: number;
  uploadType?: string;
}

/**
 * Maps Firebase Storage error codes to clear Arabic and English messages
 */
export function mapFirebaseStorageError(
  error: any,
  context?: { fileName?: string; fileSize?: number; uploadType?: string }
): BrandingErrorDetails {
  const code = error?.code || 'storage/unknown';
  const rawMessage = error?.message || String(error);
  const timestamp = new Date().toISOString();

  let messageAr = 'تعذر رفع الصورة. تحقق من اتصال الإنترنت أو صلاحيات التخزين.';
  let messageEn = 'Image upload failed. Check your internet connection or storage permissions.';

  switch (code) {
    case 'storage/unauthorized':
      messageAr = 'غير مصرح لك برفع الملفات (صلاحية المشرف العام SUPER_ADMIN مطلوبة)';
      messageEn = 'You are not authorized to upload files (SUPER_ADMIN role required)';
      break;
    case 'storage/canceled':
      messageAr = 'تم إلغاء رفع الملف';
      messageEn = 'Upload was canceled';
      break;
    case 'storage/retry-limit-exceeded':
      messageAr = 'تعذر إكمال الرفع بسبب تجاوز حد المحاولات، يرجى المحاولة مرة أخرى';
      messageEn = 'Could not complete upload due to retry limit exceeded, please try again';
      break;
    case 'storage/network-request-failed':
      messageAr = 'فشل الاتصال بالشبكة أثناء رفع الصورة، يرجى التحقق من اتصال الإنترنت';
      messageEn = 'Network request failed during image upload, please check your internet connection';
      break;
    case 'storage/quota-exceeded':
      messageAr = 'تم تجاوز حصة التخزين المتاحة في السحابة';
      messageEn = 'Cloud storage quota exceeded';
      break;
    case 'storage/object-not-found':
      messageAr = 'الملف غير موجود في التخزين السحابي';
      messageEn = 'File not found in cloud storage';
      break;
    case 'storage/invalid-argument':
      messageAr = 'معاملات الرفع غير صالحة';
      messageEn = 'Invalid upload arguments';
      break;
    case 'storage/timeout':
      messageAr = 'انتهت مهلة الرفع (30 ثانية). تحقق من سرعة الاتصال بالإنترنت وأعد المحاولة.';
      messageEn = 'Upload timed out (30s). Check your internet connection speed and retry.';
      break;
    default:
      if (rawMessage.includes('SUPER_ADMIN') || rawMessage.includes('غير مصرح')) {
        messageAr = 'غير مصرح برفع الصور (صلاحية المشرف العام مطلوبة)';
        messageEn = 'Not authorized to upload branding assets (SUPER_ADMIN required)';
      } else if (rawMessage.includes('حجم الصورة') || rawMessage.includes('exceeds')) {
        messageAr = 'حجم الصورة أكبر من الحد المسموح (الحد الأقصى 5 ميجابايت)';
        messageEn = 'Image size exceeds the allowed limit (5MB maximum)';
      } else if (rawMessage.includes('نوع الملف') || rawMessage.includes('Unsupported')) {
        messageAr = 'نوع الملف غير مدعوم (المسموح: PNG, JPG, JPEG, WEBP)';
        messageEn = 'Unsupported file type (Allowed: PNG, JPG, JPEG, WEBP)';
      } else {
        messageAr = `فشل رفع الصورة: ${rawMessage}`;
        messageEn = `Upload failed: ${rawMessage}`;
      }
      break;
  }

  const details: BrandingErrorDetails = {
    code,
    messageAr,
    messageEn,
    rawMessage,
    timestamp,
    fileName: context?.fileName,
    fileSize: context?.fileSize,
    uploadType: context?.uploadType,
  };

  // Structured diagnostic console logging (no passwords, tokens, or sensitive credentials)
  console.error('[ASFOUR Branding Diagnostic]', {
    uploadType: details.uploadType || 'unknown',
    fileName: details.fileName || 'unknown',
    fileSize: details.fileSize ? `${(details.fileSize / (1024 * 1024)).toFixed(2)} MB` : 'unknown',
    firebaseErrorCode: details.code,
    message: details.rawMessage,
    timestamp: details.timestamp,
  });

  return details;
}

/**
 * Verify current user has SUPER_ADMIN authorization
 */
export async function verifySuperAdminPermission(): Promise<{ uid: string; email: string }> {
  const currentUser = auth.currentUser;
  if (!currentUser) {
    throw new Error('غير مصرح برفع الصور: يجب تسجيل الدخول بحساب المشرف العام أولاً.');
  }

  // Fast-track for primary security email
  if (currentUser.email && currentUser.email.toLowerCase() === SECURITY_ADMIN_EMAIL.toLowerCase()) {
    return { uid: currentUser.uid, email: currentUser.email };
  }

  try {
    const adminDocRef = doc(db, 'adminUsers', currentUser.uid);
    const snap = await getDoc(adminDocRef);
    if (snap.exists()) {
      const data = snap.data();
      if ((data.role === 'SUPER_ADMIN' || data.role === 'ADMIN') && data.active === true) {
        return { uid: currentUser.uid, email: currentUser.email || data.email || 'Admin' };
      }
    }
  } catch (err) {
    console.warn('Could not verify adminUsers record in Firestore:', err);
  }

  throw new Error('غير مصرح برفع الصور: هذه العملية تتطلب صلاحية المشرف العام (SUPER_ADMIN).');
}

/**
 * Validate image file format and size
 */
export function validateImageFile(file: File): void {
  if (!file) {
    throw new Error('لم يتم تحديد أي ملف للرفع.');
  }

  const type = file.type?.toLowerCase() || '';
  if (!ALLOWED_IMAGE_TYPES.includes(type)) {
    throw new Error('نوع الملف غير مدعوم. الصيغ المسموحة هي: PNG, JPG, JPEG, WEBP فقط.');
  }

  if (file.size > MAX_FILE_SIZE_BYTES) {
    const sizeMb = (file.size / (1024 * 1024)).toFixed(2);
    throw new Error(`حجم الصورة (${sizeMb} ميجابايت) أكبر من الحد المسموح به (5 ميجابايت كحد أقصى).`);
  }
}

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
      console.warn('Branding subscription notice:', err);
      if (onError) onError(err);
    }
  );
}

/**
 * Upload manual branding file to Firebase Cloud Storage with real progress tracking and timeout
 */
export async function uploadBrandingFile(
  file: File,
  type: 'company_logo' | 'developer',
  onProgress?: (progressPercent: number) => void,
  timeoutMs: number = UPLOAD_TIMEOUT_MS
): Promise<BrandingUploadResult> {
  // 1. Auth & Permission Check
  const verifiedUser = await verifySuperAdminPermission();

  // 2. File Validation
  validateImageFile(file);

  // 3. Storage Path Construction
  const ext = file.name.split('.').pop()?.toLowerCase() || (type === 'company_logo' ? 'png' : 'jpg');
  const timestamp = Date.now();
  const folder = type === 'company_logo' ? 'branding/company-logo' : 'branding/developer';
  const prefix = type === 'company_logo' ? 'company-logo' : 'developer';
  const storagePath = `${folder}/${prefix}-${timestamp}.${ext}`;

  const storageRef = ref(storage, storagePath);

  // 4. Metadata
  const metadata = {
    contentType: file.type,
    customMetadata: {
      originalName: file.name,
      uploadedAt: new Date().toISOString(),
      uploadedByUid: verifiedUser.uid,
      uploadedByEmail: verifiedUser.email,
      assetType: type,
    },
  };

  // 5. Upload via uploadBytesResumable
  return new Promise<BrandingUploadResult>((resolve, reject) => {
    let hasCompleted = false;
    const uploadTask = uploadBytesResumable(storageRef, file, metadata);

    // 30s Timeout Failsafe
    const timer = setTimeout(() => {
      if (!hasCompleted) {
        hasCompleted = true;
        uploadTask.cancel();
        const timeoutErr = {
          code: 'storage/timeout',
          message: 'انتهت مهلة رفع الصورة (30 ثانية). تحقق من اتصال الإنترنت وأعد المحاولة.',
        };
        const errorDetails = mapFirebaseStorageError(timeoutErr, {
          fileName: file.name,
          fileSize: file.size,
          uploadType: type,
        });
        reject(new Error(errorDetails.messageAr));
      }
    }, timeoutMs);

    // Initial 0% progress
    if (onProgress) onProgress(0);

    uploadTask.on(
      'state_changed',
      (snapshot) => {
        if (snapshot.totalBytes > 0) {
          const progress = Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100);
          if (onProgress) onProgress(Math.min(progress, 99));
        }
      },
      (error) => {
        clearTimeout(timer);
        if (!hasCompleted) {
          hasCompleted = true;
          const errorDetails = mapFirebaseStorageError(error, {
            fileName: file.name,
            fileSize: file.size,
            uploadType: type,
          });
          reject(new Error(errorDetails.messageAr));
        }
      },
      async () => {
        clearTimeout(timer);
        if (hasCompleted) return;
        hasCompleted = true;

        if (onProgress) onProgress(100);

        try {
          const rawUrl = await getDownloadURL(uploadTask.snapshot.ref);
          if (!rawUrl || rawUrl.trim() === '') {
            throw new Error('لم يتم استرجاع رابط التحميل من التخزين السحابي.');
          }

          // Cache-busting URL to ensure instant fresh display
          const downloadUrl = `${rawUrl}${rawUrl.includes('?') ? '&' : '?'}v=${timestamp}`;

          resolve({
            downloadUrl,
            storagePath,
            fileName: file.name,
            contentType: file.type,
            size: file.size,
          });
        } catch (urlErr: any) {
          const errorDetails = mapFirebaseStorageError(urlErr, {
            fileName: file.name,
            fileSize: file.size,
            uploadType: type,
          });
          reject(new Error(errorDetails.messageAr));
        }
      }
    );
  });
}

/**
 * Save / Update branding metadata in Firestore (`system_settings/branding`)
 */
export async function saveBrandingSettings(
  updates: Partial<BrandingSettings>,
  user?: { uid: string; email: string }
): Promise<void> {
  const currentUser = auth.currentUser || user;
  const docRef = doc(db, 'system_settings', 'branding');

  const rawPayload: Record<string, any> = {
    ...updates,
    updatedAt: new Date().toISOString(),
    serverUpdatedAt: serverTimestamp(),
    updatedByUid: currentUser?.uid || 'admin',
    updatedByEmail: currentUser?.email || 'admin@asfour.local',
  };

  const payload = sanitizeBrandingPayload(rawPayload);

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
 * Full Safe Upload & Replacement Workflow:
 * 1. Uploads new file to Storage first
 * 2. Saves metadata in Firestore
 * 3. Only after Firestore is successfully updated, removes the old file from Storage
 */
export async function uploadAndReplaceBrandingAsset(
  file: File,
  type: 'company_logo' | 'developer',
  oldStoragePath?: string | null,
  onProgress?: (progressPercent: number) => void
): Promise<BrandingUploadResult> {
  // Step 1: Upload new asset to Firebase Storage
  const uploaded = await uploadBrandingFile(file, type, onProgress);

  // Step 2: Persist metadata in Firestore
  const updatePayload: Partial<BrandingSettings> = type === 'company_logo'
    ? {
        companyLogoUrl: uploaded.downloadUrl,
        companyLogoPath: uploaded.storagePath,
        companyLogoFileName: uploaded.fileName,
        companyLogoContentType: uploaded.contentType,
        companyLogoSize: uploaded.size,
        companyLogoUpdatedAt: new Date().toISOString(),
        companyLogoUpdatedByUid: auth.currentUser?.uid || null,
      }
    : {
        developerImageUrl: uploaded.downloadUrl,
        developerImagePath: uploaded.storagePath,
        developerImageFileName: uploaded.fileName,
        developerImageContentType: uploaded.contentType,
        developerImageSize: uploaded.size,
        developerImageUpdatedAt: new Date().toISOString(),
        developerImageUpdatedByUid: auth.currentUser?.uid || null,
      };

  await saveBrandingSettings(updatePayload);

  // Step 3: Clean up old asset in storage if path changed
  if (oldStoragePath && oldStoragePath !== uploaded.storagePath && !oldStoragePath.startsWith('http')) {
    try {
      const oldRef = ref(storage, oldStoragePath);
      await deleteObject(oldRef);
    } catch (cleanErr) {
      console.warn('Could not delete old storage object after replacement:', cleanErr);
    }
  }

  return uploaded;
}

/**
 * Delete / Reset branding asset and clear Firestore metadata
 */
export async function deleteBrandingAsset(
  type: 'company_logo' | 'developer',
  currentPath?: string | null
): Promise<void> {
  // Check permission
  await verifySuperAdminPermission();

  // 1. Delete from Firebase Storage if path exists
  if (currentPath && !currentPath.startsWith('inline://') && !currentPath.startsWith('data:') && !currentPath.startsWith('http')) {
    try {
      const storageRef = ref(storage, currentPath);
      await deleteObject(storageRef);
    } catch (storageErr) {
      console.warn('Notice: Could not delete storage object during asset reset:', storageErr);
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
        companyLogoUpdatedByUid: null,
      }
    : {
        developerImageUrl: null,
        developerImagePath: null,
        developerImageFileName: null,
        developerImageContentType: null,
        developerImageSize: null,
        developerImageUpdatedAt: new Date().toISOString(),
        developerImageUpdatedByUid: null,
      };

  await saveBrandingSettings(clearPayload);

  await logAuditAction(
    'UPDATE',
    'system_settings',
    'branding',
    `Removed manual branding asset for ${type}`
  );
}


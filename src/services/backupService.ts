/**
 * ASFOUR Factory Management ERP - Backup & Disaster Recovery Service
 * Provides automated & manual Firestore backups, retention tracking,
 * backup verification, and cold-storage export.
 * 
 * ARCHITECTURE RULE:
 * 1. Firestore `system_backups` collection stores ONLY lightweight metadata (record counts, checksum, size, timestamp).
 * 2. Complete multi-collection JSON payload is generated in memory, validated, and directly downloaded as a .json file.
 * 3. Never writes giant JSON payloads into Firestore documents to strictly comply with the 1 MiB document limit.
 * 4. A failure in metadata persistence (Stage 7) NEVER invalidates or discards a successfully generated local backup.
 */
import { 
  collection, 
  getDocs, 
  doc, 
  setDoc, 
  deleteDoc, 
  query, 
  orderBy, 
  serverTimestamp,
  Timestamp 
} from 'firebase/firestore';
import { db, auth } from '../config/firebase';
import { SystemBackup, BackupType, BackupStatus } from '../types';
import { CURRENT_APP_VERSION, DATABASE_SCHEMA_VERSION, BUILD_ID } from '../config/appVersion';
import { logAuditAction } from './auditService';

// In-memory cache for backup payloads generated during the current active session
export const memoryBackupCache = new Map<string, string>();

// All critical collections required for complete business continuity
export const BACKUP_COLLECTIONS = [
  'employees',
  'departments',
  'products',
  'productTypes',
  'customers',
  'shifts',
  'presses',
  'furnaces',
  'furnaceCars',
  'production',
  'productionEmployees',
  'productionFurnaceCars',
  'materials',
  'downtime',
  'stage_rotary_furnace',
  'stage_chinese_mills',
  'stage_tube_mills',
  'stage_mortar_concrete',
  'stage_mixing',
  'stage_lightweight',
  'stage_sorting',
  'audit_logs',
  'system_settings'
];

/**
 * Format timestamp into standard backup file name:
 * ASFOUR_Backup_YYYY-MM-DD_HH-mm-ss.json
 */
export function formatBackupFileName(date: Date, backupCode?: string): string {
  const pad = (n: number) => n.toString().padStart(2, '0');
  const yyyy = date.getFullYear();
  const MM = pad(date.getMonth() + 1);
  const dd = pad(date.getDate());
  const HH = pad(date.getHours());
  const mm = pad(date.getMinutes());
  const ss = pad(date.getSeconds());
  return `ASFOUR_Backup_${yyyy}-${MM}-${dd}_${HH}-${mm}-${ss}.json`;
}

/**
 * Robust SHA-256 / Checksum calculation from the exact payload string
 */
export async function calculateSha256(content: string): Promise<string> {
  try {
    if (typeof window !== 'undefined' && window.crypto && window.crypto.subtle) {
      const msgUint8 = new TextEncoder().encode(content);
      const hashBuffer = await window.crypto.subtle.digest('SHA-256', msgUint8);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
    }
  } catch {
    // fallback to fast hash below
  }
  return calculateChecksum(content);
}

/**
 * Generate standard fallback checksum string
 */
export function calculateChecksum(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0; // Convert to 32bit integer
  }
  return 'CHK-' + Math.abs(hash).toString(16).toUpperCase().padStart(8, '0');
}

/**
 * Robust Firestore Data Sanitizer:
 * Recursively inspects all properties:
 * - undefined -> omitted entirely
 * - invalid Date -> null
 * - NaN / Infinity -> null
 * - valid primitives -> preserved unchanged
 * - Arrays & Objects -> recursively sanitized
 * - Firestore FieldValues (e.g. serverTimestamp()) -> preserved
 */
export function sanitizeFirestoreData<T = any>(data: T): any {
  if (data === undefined) {
    return undefined;
  }
  if (data === null) {
    return null;
  }
  if (typeof data === 'number') {
    if (isNaN(data) || !isFinite(data)) {
      return null;
    }
    return data;
  }
  if (typeof data === 'boolean' || typeof data === 'string') {
    return data;
  }
  if (data instanceof Date) {
    if (isNaN(data.getTime())) {
      return null;
    }
    return data;
  }
  if (data instanceof Timestamp) {
    return data;
  }
  // Firestore FieldValues (serverTimestamp, deleteField, arrayUnion, etc.)
  if (typeof data === 'object') {
    const obj = data as any;
    if (obj._methodName || obj.constructor?.name === 'FieldValueImpl' || obj.constructor?.name === 'FieldValue') {
      return data;
    }
    if (Array.isArray(obj)) {
      return obj
        .map((item) => sanitizeFirestoreData(item))
        .filter((item) => item !== undefined);
    }
    const cleanObj: Record<string, any> = {};
    for (const [key, val] of Object.entries(obj)) {
      if (val === undefined) {
        continue; // Strictly omit undefined fields (prevents retentionTag: undefined)
      }
      const sanitized = sanitizeFirestoreData(val);
      if (sanitized !== undefined) {
        cleanObj[key] = sanitized;
      }
    }
    return cleanObj;
  }
  return data;
}

/**
 * Perform a full database backup with independent resilient stages:
 * 
 * STAGE 1: Read Firestore data from all collections
 * STAGE 2: Build complete backup payload
 * STAGE 3: Validate JSON structure and integrity
 * STAGE 4: Calculate SHA-256 Checksum from exact payload
 * STAGE 5: Create downloadable Blob and verify size > 0
 * STAGE 6: Trigger browser file download
 * STAGE 7: Write lightweight metadata to Firestore system_backups (with graceful failure handling)
 */
export async function createDatabaseBackup(
  type: BackupType = 'MANUAL',
  notes: string = '',
  onProgress?: (stage: string, percent: number) => void,
  autoDownload: boolean = true
): Promise<SystemBackup> {
  const now = new Date();
  const timestamp = now.toISOString();
  const dateSegment = timestamp.replace(/[-:T]/g, '').slice(0, 14);
  const randomSuffix = Math.random().toString(36).substring(2, 6).toUpperCase();
  const backupCode = `BCK-${dateSegment}-${randomSuffix}`;
  const fileName = formatBackupFileName(now, backupCode);

  // ==========================================
  // STAGE 1: Read Firestore Data
  // ==========================================
  if (onProgress) onProgress('المرحلة 1/7: بدء جمع البيانات من كافة المجموعات المصنعية...', 5);

  const backupData: Record<string, any[]> = {};
  const recordCounts: Record<string, number> = {};
  let totalRecords = 0;

  for (let i = 0; i < BACKUP_COLLECTIONS.length; i++) {
    const colName = BACKUP_COLLECTIONS[i];
    try {
      const snap = await getDocs(collection(db, colName));
      const docsData: any[] = [];
      snap.forEach((docSnap) => {
        const d = docSnap.data();
        // Sanitize any sensitive credentials if ever present
        delete d.password;
        delete d.passwordHash;
        delete d.apiSecret;
        delete d.token;
        delete d.secretKey;
        docsData.push({ _id: docSnap.id, ...d });
      });
      backupData[colName] = docsData;
      recordCounts[colName] = docsData.length;
      totalRecords += docsData.length;
    } catch (err: any) {
      console.warn(`Could not backup collection ${colName}:`, err.message);
      backupData[colName] = [];
      recordCounts[colName] = 0;
    }

    if (onProgress) {
      const percent = Math.round(5 + ((i + 1) / BACKUP_COLLECTIONS.length) * 55);
      onProgress(`تمت قراءة مجموعة: ${colName} (${recordCounts[colName]} سجل)`, percent);
    }
  }

  // ==========================================
  // STAGE 2: Build Backup Payload
  // ==========================================
  if (onProgress) onProgress('المرحلة 2/7: بناء هيكل حزمة البيانات الوصفية والتشغيلية...', 65);
  
  const fullPayloadObject = {
    metadata: {
      backupId: backupCode,
      fileName,
      createdAt: timestamp,
      createdByUid: auth.currentUser?.uid || 'SYSTEM',
      createdByName: auth.currentUser?.email || 'مشرف النظام',
      type,
      schemaVersion: DATABASE_SCHEMA_VERSION,
      appVersion: CURRENT_APP_VERSION.version,
      buildId: BUILD_ID,
      totalRecords,
      recordCounts,
      storageLocation: 'LOCAL_JSON',
      notes: notes || (type === 'PRE_IMPORT' ? 'نسخة احتياطية وقائية قبل الاستيراد المجمع' : type === 'SAFETY_CHECKPOINT' ? 'نقطة أمان قبل الاستعادة' : 'نسخة احتياطية شاملة'),
    },
    data: backupData
  };

  const serializedPayload = JSON.stringify(fullPayloadObject, null, 2);
  
  // ==========================================
  // STAGE 3: Validate JSON Structure
  // ==========================================
  if (onProgress) onProgress('المرحلة 3/7: التحقق الصارم من سلامة بنية ملف الـ JSON...', 75);
  try {
    const testParse = JSON.parse(serializedPayload);
    if (!testParse.data || !testParse.metadata) {
      throw new Error('فشل التحقق من بنية حزمة النسخ الاحتياطي (غياب metadata أو data).');
    }
  } catch (parseErr: any) {
    throw new Error(`خطأ في فحص سلامة ملف النسخ الاحتياطي: ${parseErr.message}`);
  }

  // ==========================================
  // STAGE 4: Calculate Checksum (SHA-256)
  // ==========================================
  if (onProgress) onProgress('المرحلة 4/7: حساب البصمة الرقمية المشفرة (SHA-256)...', 82);
  const checksum = await calculateSha256(serializedPayload);

  // ==========================================
  // STAGE 5: Create Downloadable Blob
  // ==========================================
  if (onProgress) onProgress('المرحلة 5/7: إنشاء كائن الملف (Blob) والتحقق من الحجم...', 88);
  const blob = new Blob([serializedPayload], { type: 'application/json;charset=utf-8;' });
  const sizeBytes = blob.size;

  if (sizeBytes === 0) {
    throw new Error('حجم ملف النسخ الاحتياطي 0 بايت - تم إلغاء العملية لعدم صلاحية الملف.');
  }

  // Cache in active session memory for instant download/restore operations
  memoryBackupCache.set(backupCode, serializedPayload);

  // ==========================================
  // STAGE 6: Trigger Browser File Download
  // ==========================================
  if (autoDownload) {
    if (onProgress) onProgress('المرحلة 6/7: بدء تنزيل ملف النسخة الاحتياطية إلى جهاز المستخدم...', 92);
    try {
      triggerBrowserFileDownload(fileName, serializedPayload);
    } catch (downloadErr: any) {
      console.warn('Auto download trigger warning:', downloadErr);
    }
  }

  // ==========================================
  // STAGE 7: Write Backup Metadata to Firestore
  // ==========================================
  if (onProgress) onProgress('المرحلة 7/7: توثيق البيانات الوصفية في السجل السحابي الآمن...', 96);

  const user = auth.currentUser;
  const backupDocRef = doc(collection(db, 'system_backups'), backupCode);

  // Clean metadata object - strictly no undefined fields
  const baseMetadataRecord: SystemBackup = {
    id: backupDocRef.id,
    backupId: backupCode,
    fileName,
    createdAt: timestamp,
    createdBy: user?.uid || 'SYSTEM',
    createdByName: user?.email || 'مشرف النظام',
    type,
    schemaVersion: DATABASE_SCHEMA_VERSION,
    appVersion: CURRENT_APP_VERSION.version,
    buildId: BUILD_ID,
    status: 'SUCCESS',
    notes: notes || (type === 'PRE_IMPORT' ? 'نسخة احتياطية وقائية قبل الاستيراد المجمع' : type === 'SAFETY_CHECKPOINT' ? 'نقطة أمان قبل الاستعادة' : 'نسخة احتياطية شاملة'),
    collections: Object.keys(backupData).filter(c => backupData[c].length > 0),
    recordCounts,
    totalRecords,
    sizeBytes,
    checksum,
    storageLocation: 'LOCAL_JSON',
    // Only include retentionTag when type is SCHEDULED, otherwise omitted
    ...(type === 'SCHEDULED' ? { retentionTag: 'DAILY' } : {}),
  };

  let finalStatus: BackupStatus = 'SUCCESS';
  let firestoreErrorMessage: string | undefined = undefined;

  try {
    const cleanFirestorePayload = sanitizeFirestoreData({
      ...baseMetadataRecord,
      serverCreatedAt: serverTimestamp(),
    });

    // Write ONLY the lightweight metadata document to Firestore (approx. 1-2 KB, safe under 1 MiB limit)
    await setDoc(backupDocRef, cleanFirestorePayload);

    // Audit log
    await logAuditAction(
      'BACKUP_CREATE',
      'system_backups',
      backupCode,
      `تم إنشاء نسخة احتياطية ناجحة (${type}): ${totalRecords} سجل - الحجم: ${(sizeBytes / 1024).toFixed(1)} KB - البصمة: ${checksum}`
    ).catch(() => {});
  } catch (metaErr: any) {
    console.error('Firestore backup metadata write failure (file remains safely generated):', metaErr);
    finalStatus = 'FILE_READY_METADATA_FAILED';
    firestoreErrorMessage = metaErr.message || 'فشل الاتصال لتسجيل البيانات الوصفية في Firestore';
  }

  if (onProgress) {
    if (finalStatus === 'SUCCESS') {
      onProgress('اكتمل النسخ الاحتياطي وتوثيق السجل وتنزيل الملف بنجاح!', 100);
    } else {
      onProgress('تم تجهيز وتنزيل ملف النسخ الاحتياطي، ولكن تعذر توثيق السجل في Firestore.', 100);
    }
  }

  return {
    ...baseMetadataRecord,
    status: finalStatus,
    ...(firestoreErrorMessage ? { errorMessage: firestoreErrorMessage } : {}),
    dataPayload: serializedPayload // Retain for immediate UI interactions
  };
}

/**
 * Retry saving metadata for an already generated backup
 */
export async function retrySaveBackupMetadata(backup: SystemBackup): Promise<SystemBackup> {
  const backupDocRef = doc(collection(db, 'system_backups'), backup.backupId);
  const cleanPayload = sanitizeFirestoreData({
    id: backupDocRef.id,
    backupId: backup.backupId,
    fileName: backup.fileName || formatBackupFileName(new Date(backup.createdAt), backup.backupId),
    createdAt: backup.createdAt,
    createdBy: backup.createdBy,
    createdByName: backup.createdByName,
    type: backup.type,
    schemaVersion: backup.schemaVersion,
    appVersion: backup.appVersion,
    buildId: backup.buildId,
    status: 'SUCCESS',
    notes: backup.notes || '',
    collections: backup.collections,
    recordCounts: backup.recordCounts,
    totalRecords: backup.totalRecords,
    sizeBytes: backup.sizeBytes,
    checksum: backup.checksum,
    storageLocation: 'LOCAL_JSON',
    ...(backup.type === 'SCHEDULED' ? { retentionTag: 'DAILY' } : {}),
    serverCreatedAt: serverTimestamp(),
  });

  await setDoc(backupDocRef, cleanPayload);

  await logAuditAction(
    'BACKUP_CREATE',
    'system_backups',
    backup.backupId,
    `تمت إعادة حفظ توثيق النسخة الاحتياطية (${backup.type}): ${backup.totalRecords} سجل`
  ).catch(() => {});

  return {
    ...backup,
    status: 'SUCCESS',
    errorMessage: undefined,
  };
}

/**
 * Trigger immediate browser download of a text/JSON file
 */
export function triggerBrowserFileDownload(fileName: string, content: string): void {
  const blob = new Blob([content], { type: 'application/json;charset=utf-8;' });
  if (blob.size === 0) {
    throw new Error('فشل التنزيل: حجم الملف 0 بايت.');
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', fileName);
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => {
    try {
      URL.revokeObjectURL(url);
    } catch {
      // ignore
    }
  }, 1500);
}

/**
 * Fetch all available system backups (metadata only)
 */
export async function fetchBackups(): Promise<SystemBackup[]> {
  try {
    const q = query(collection(db, 'system_backups'), orderBy('createdAt', 'desc'));
    const snap = await getDocs(q);
    return snap.docs.map((docSnap) => {
      const data = docSnap.data() as SystemBackup;
      return {
        ...data,
        id: docSnap.id,
      };
    });
  } catch (error) {
    console.error('Error fetching system backups:', error);
    return [];
  }
}

/**
 * Delete a backup with audit log
 */
export async function deleteBackup(backupId: string, backupCode: string): Promise<void> {
  const docRef = doc(db, 'system_backups', backupId);
  await deleteDoc(docRef);

  // Clear from session cache if present
  memoryBackupCache.delete(backupCode);

  await logAuditAction(
    'BACKUP_DELETE',
    'system_backups',
    backupCode,
    `تم حذف سجل النسخة الاحتياطية: ${backupCode}`
  );
}

/**
 * Export backup as downloadable JSON file
 * Returns true if download was triggered, false if payload not available in memory
 */
export function exportBackupToFile(backup: SystemBackup): boolean {
  // Check in-memory session cache or backup object
  const rawPayload = backup.dataPayload || memoryBackupCache.get(backup.backupId);

  if (!rawPayload) {
    return false;
  }

  const fileName = backup.fileName || formatBackupFileName(new Date(backup.createdAt), backup.backupId);
  triggerBrowserFileDownload(fileName, rawPayload);
  return true;
}

/**
 * Health statistics for backup center
 */
export interface BackupHealthStats {
  totalBackups: number;
  lastBackupDate: string | null;
  lastBackupHoursAgo: number | null;
  healthState: 'GREEN' | 'YELLOW' | 'RED';
  healthMessage: string;
  totalRecordsProtected: number;
  latestChecksum: string | null;
}

export function evaluateBackupHealth(backups: SystemBackup[]): BackupHealthStats {
  if (!backups || backups.length === 0) {
    return {
      totalBackups: 0,
      lastBackupDate: null,
      lastBackupHoursAgo: null,
      healthState: 'RED',
      healthMessage: 'لم يتم العثور على أي نسخ احتياطية مسجلة! يرجى إنشاء نسخة احتياطية فوراً.',
      totalRecordsProtected: 0,
      latestChecksum: null,
    };
  }

  const latest = backups[0];
  const lastDate = new Date(latest.createdAt);
  const now = new Date();
  const diffHours = Math.round((now.getTime() - lastDate.getTime()) / (1000 * 60 * 60));

  let healthState: 'GREEN' | 'YELLOW' | 'RED' = 'GREEN';
  let healthMessage = 'النسخ الاحتياطي في حالة ممتازة ومطابق للمواصفات.';

  if (diffHours > 72 || latest.status === 'FAILED') {
    healthState = 'RED';
    healthMessage = `تنبيه حرج: آخر نسخة احتياطية تمت منذ ${diffHours} ساعة أو بها فشل!`;
  } else if (diffHours > 24) {
    healthState = 'YELLOW';
    healthMessage = `تنبيه: مضى ${diffHours} ساعة على آخر نسخة احتياطية. يُنصح بعمل نسخة جديدة.`;
  }

  return {
    totalBackups: backups.length,
    lastBackupDate: latest.createdAt,
    lastBackupHoursAgo: diffHours,
    healthState,
    healthMessage,
    totalRecordsProtected: latest.totalRecords,
    latestChecksum: latest.checksum,
  };
}


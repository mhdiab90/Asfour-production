/**
 * ASFOUR Factory Management ERP - Backup & Disaster Recovery Service
 * Provides automated & manual Firestore backups, retention tracking,
 * backup verification, and cold-storage export.
 * 
 * ARCHITECTURE RULE:
 * 1. Firestore `system_backups` collection stores ONLY metadata (record counts, checksum, size, timestamp).
 * 2. Complete multi-collection JSON payload is generated in memory, validated, and directly downloaded as a .json file.
 * 3. Never writes giant JSON payloads into Firestore documents to strictly comply with the 1 MiB document limit.
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
 * Generate a standard CRC32/Hash checksum of the serialized backup string
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
 * Format timestamp into standard backup file name
 * e.g. ASFOUR_Backup_2026-08-22_120800.json
 */
export function formatBackupFileName(date: Date, backupCode: string): string {
  const d = date.toISOString().replace(/T/, '_').replace(/:/g, '').slice(0, 15);
  return `ASFOUR_Backup_${d}_${backupCode.slice(-4)}.json`;
}

/**
 * Perform a full database backup
 * Reads all collections, validates JSON, caches in memory, triggers download,
 * and saves ONLY metadata to Firestore to respect the 1 MiB document limit.
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

  // Stage 1: STARTED
  if (onProgress) onProgress('بدء جمع البيانات من كافة المجموعات المصنعية...', 5);

  const backupData: Record<string, any[]> = {};
  const recordCounts: Record<string, number> = {};
  let totalRecords = 0;

  // Stage 2: READING collections
  for (let i = 0; i < BACKUP_COLLECTIONS.length; i++) {
    const colName = BACKUP_COLLECTIONS[i];
    try {
      const snap = await getDocs(collection(db, colName));
      const docsData: any[] = [];
      snap.forEach((docSnap) => {
        const d = docSnap.data();
        // Sanitize any sensitive tokens/credentials if ever present
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
      const percent = Math.round(5 + ((i + 1) / BACKUP_COLLECTIONS.length) * 65);
      onProgress(`تم قراءة مجموعة: ${colName} (${recordCounts[colName]} سجل)`, percent);
    }
  }

  // Stage 3: SERIALIZING & VERIFICATION
  if (onProgress) onProgress('جاري تجهيز حزمة البيانات والتحقق من صحة البنية (JSON)...', 75);
  
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
  
  // Validation: Ensure valid JSON by testing deserialization
  try {
    const testParse = JSON.parse(serializedPayload);
    if (!testParse.data || !testParse.metadata) {
      throw new Error('فشل التحقق من بنية حزمة النسخ الاحتياطي.');
    }
  } catch (parseErr: any) {
    throw new Error(`خطأ في فحص سلامة ملف النسخ الاحتياطي: ${parseErr.message}`);
  }

  // Stage 4: CHECKSUM & SIZE
  if (onProgress) onProgress('جاري حساب البصمة الرقمية (Checksum) والتحقق من الحجم...', 85);
  const blob = new Blob([serializedPayload], { type: 'application/json;charset=utf-8;' });
  const sizeBytes = blob.size;
  const checksum = calculateChecksum(serializedPayload);

  if (sizeBytes === 0) {
    throw new Error('حجم ملف النسخ الاحتياطي 0 بايت - تم إلغاء العملية.');
  }

  // Cache in active session memory
  memoryBackupCache.set(backupCode, serializedPayload);

  // Stage 5: SAVE METADATA ONLY TO FIRESTORE (Strictly NO dataPayload in Firestore)
  if (onProgress) onProgress('جاري توثيق البيانات الوصفية في السجل الآمن...', 90);

  const user = auth.currentUser;
  const backupDocRef = doc(collection(db, 'system_backups'), backupCode);

  const metadataRecord: SystemBackup = {
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
    retentionTag: type === 'SCHEDULED' ? 'DAILY' : undefined,
  };

  // Write ONLY the lightweight metadata document to Firestore (approx. 1-2 KB, safe under 1 MiB limit)
  await setDoc(backupDocRef, {
    ...metadataRecord,
    serverCreatedAt: serverTimestamp(),
  });

  // Stage 6: AUDIT LOG
  await logAuditAction(
    'BACKUP_CREATE',
    'system_backups',
    backupCode,
    `تم إنشاء نسخة احتياطية ناجحة (${type}): ${totalRecords} سجل - الحجم: ${(sizeBytes / 1024).toFixed(1)} KB - البصمة: ${checksum}`
  );

  // Stage 7: AUTO DOWNLOAD (if enabled)
  if (autoDownload) {
    if (onProgress) onProgress('جاري بدء تنزيل ملف النسخة الاحتياطية...', 95);
    triggerBrowserFileDownload(fileName, serializedPayload);
  }

  if (onProgress) onProgress('اكتمل النسخ الاحتياطي وتجهيز الملف بنجاح!', 100);

  return {
    ...metadataRecord,
    dataPayload: serializedPayload // Available in client return value
  };
}

/**
 * Trigger immediate browser download of a text/JSON file
 */
export function triggerBrowserFileDownload(fileName: string, content: string): void {
  const blob = new Blob([content], { type: 'application/json;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', fileName);
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
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
  let rawPayload = backup.dataPayload || memoryBackupCache.get(backup.backupId);

  if (!rawPayload) {
    return false;
  }

  const fileName = backup.fileName || `ASFOUR_Backup_${backup.backupId}_${backup.createdAt.split('T')[0]}.json`;
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

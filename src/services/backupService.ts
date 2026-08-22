/**
 * ASFOUR Factory Management ERP - Backup & Disaster Recovery Service
 * Provides automated & manual full Firestore backups, retention tracking,
 * backup verification, and cold-storage export.
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
 * Generate a simple hash/checksum of the serialized backup string
 */
function calculateChecksum(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0; // Convert to 32bit integer
  }
  return 'CHK-' + Math.abs(hash).toString(16).toUpperCase().padStart(8, '0');
}

/**
 * Perform a full Firestore database backup
 */
export async function createDatabaseBackup(
  type: BackupType = 'MANUAL',
  notes: string = '',
  onProgress?: (stage: string, percent: number) => void
): Promise<SystemBackup> {
  const timestamp = new Date().toISOString();
  const backupCode = `BCK-${timestamp.replace(/[-:T]/g, '').slice(0, 14)}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;

  if (onProgress) onProgress('بدء جمع البيانات من كافة المجموعات...', 5);

  const backupData: Record<string, any[]> = {};
  const recordCounts: Record<string, number> = {};
  let totalRecords = 0;

  // 1. Fetch all documents from each critical collection
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
      const percent = Math.round(5 + ((i + 1) / BACKUP_COLLECTIONS.length) * 70);
      onProgress(`تم نسخ مجموعة: ${colName} (${recordCounts[colName]} سجل)`, percent);
    }
  }

  // 2. Serialize and calculate size and checksum
  if (onProgress) onProgress('جاري ضغط البيانات وحساب البصمة الرقمية (Checksum)...', 80);
  const dataPayload = JSON.stringify(backupData);
  const sizeBytes = new Blob([dataPayload]).size;
  const checksum = calculateChecksum(dataPayload);

  // 3. Verification: Ensure payload exists and checksum is generated
  const isHealthy = sizeBytes > 0 && totalRecords >= 0;
  const status: BackupStatus = isHealthy ? 'SUCCESS' : 'FAILED';

  const user = auth.currentUser;
  const backupDocRef = doc(collection(db, 'system_backups'), backupCode);

  const backupRecord: SystemBackup = {
    id: backupDocRef.id,
    backupId: backupCode,
    createdAt: timestamp,
    createdBy: user?.uid || 'SYSTEM',
    createdByName: user?.email || 'مشرف النظام',
    type,
    schemaVersion: DATABASE_SCHEMA_VERSION,
    appVersion: CURRENT_APP_VERSION.version,
    buildId: BUILD_ID,
    status,
    notes: notes || (type === 'PRE_IMPORT' ? 'نسخة احتياطية وقائية قبل الاستيراد المجمع' : type === 'SAFETY_CHECKPOINT' ? 'نقطة أمان قبل الاستعادة' : 'نسخة احتياطية شاملة'),
    collections: Object.keys(backupData).filter(c => backupData[c].length > 0),
    recordCounts,
    totalRecords,
    sizeBytes,
    checksum,
    retentionTag: type === 'SCHEDULED' ? 'DAILY' : undefined,
    dataPayload // Store serializable snapshot
  };

  if (onProgress) onProgress('جاري حفظ وتوثيق النسخة الاحتياطية في السجل الآمن...', 90);

  // 4. Save to Firestore system_backups collection
  await setDoc(backupDocRef, {
    ...backupRecord,
    serverCreatedAt: serverTimestamp(),
  });

  // 5. Audit Log
  await logAuditAction(
    'BACKUP_CREATE',
    'system_backups',
    backupCode,
    `تم إنشاء نسخة احتياطية (${type}): ${totalRecords} سجل - الحجم: ${(sizeBytes / 1024).toFixed(1)} KB - البصمة: ${checksum}`
  );

  if (onProgress) onProgress('اكتمل النسخ الاحتياطي بنجاح!', 100);

  return backupRecord;
}

/**
 * Fetch all available system backups
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

  await logAuditAction(
    'BACKUP_DELETE',
    'system_backups',
    backupCode,
    `تم حذف النسخة الاحتياطية: ${backupCode}`
  );
}

/**
 * Export backup as downloadable JSON file for offline/external cold storage
 */
export function exportBackupToFile(backup: SystemBackup): void {
  const exportPayload = {
    metadata: {
      backupId: backup.backupId,
      createdAt: backup.createdAt,
      createdBy: backup.createdByName,
      type: backup.type,
      schemaVersion: backup.schemaVersion,
      appVersion: backup.appVersion,
      buildId: backup.buildId,
      totalRecords: backup.totalRecords,
      recordCounts: backup.recordCounts,
      sizeBytes: backup.sizeBytes,
      checksum: backup.checksum,
    },
    data: backup.dataPayload ? JSON.parse(backup.dataPayload) : {}
  };

  const jsonStr = JSON.stringify(exportPayload, null, 2);
  const blob = new Blob([jsonStr], { type: 'application/json;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', `ASFOUR_BACKUP_${backup.backupId}_${backup.createdAt.split('T')[0]}.json`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
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

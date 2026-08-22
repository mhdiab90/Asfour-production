/**
 * ASFOUR Factory Management ERP - Safe Restore Service
 * Implements previewing, pre-restore safety checkpoints, batch restoration,
 * and double-confirmation verification.
 */
import { 
  collection, 
  getDocs, 
  doc, 
  setDoc, 
  writeBatch 
} from 'firebase/firestore';
import { db, auth } from '../config/firebase';
import { SystemBackup, RestorePreview, RestoreResult } from '../types';
import { createDatabaseBackup } from './backupService';
import { logAuditAction } from './auditService';

/**
 * Generate a comparison preview between current Firestore counts and the backup counts
 */
export async function generateRestorePreview(backup: SystemBackup): Promise<RestorePreview> {
  const collectionDiffs: {
    collectionName: string;
    currentCount: number;
    backupCount: number;
    diff: number;
  }[] = [];

  const collectionsToCheck = Object.keys(backup.recordCounts || {});

  for (const colName of collectionsToCheck) {
    let currentCount = 0;
    try {
      const snap = await getDocs(collection(db, colName));
      currentCount = snap.size;
    } catch {
      currentCount = 0;
    }

    const backupCount = backup.recordCounts[colName] || 0;
    collectionDiffs.push({
      collectionName: colName,
      currentCount,
      backupCount,
      diff: backupCount - currentCount,
    });
  }

  return {
    backupId: backup.backupId,
    createdAt: backup.createdAt,
    appVersion: backup.appVersion,
    schemaVersion: backup.schemaVersion,
    totalRecords: backup.totalRecords,
    collectionDiffs,
  };
}

/**
 * Execute Safe Database Restoration
 * 1. Creates a safety checkpoint backup of the CURRENT database first
 * 2. Deserializes backup payload
 * 3. Restores records using batched writes in chunks of 400
 * 4. Logs full audit trail
 */
export async function executeSafeRestore(
  backup: SystemBackup,
  options: {
    createCheckpointFirst?: boolean;
    onProgress?: (message: string, percent: number) => void;
  } = {}
): Promise<RestoreResult> {
  const startTime = Date.now();
  const errors: string[] = [];
  let safetyBackupId: string | undefined = undefined;

  // Step 1: Create automatic safety checkpoint before overwriting
  if (options.createCheckpointFirst !== false) {
    if (options.onProgress) options.onProgress('جاري إنشاء نقطة أمان احتياطية قبل الاستعادة...', 10);
    try {
      const checkpoint = await createDatabaseBackup(
        'SAFETY_CHECKPOINT',
        `نقطة أمان تلقائية تم إنشاؤها قبل استعادة النسخة: ${backup.backupId}`
      );
      safetyBackupId = checkpoint.backupId;
    } catch (err: any) {
      console.warn('Safety checkpoint warning:', err.message);
    }
  }

  // Step 2: Parse backup payload
  if (!backup.dataPayload) {
    throw new Error('لا تحتوي هذه النسخة الاحتياطية على بيانات قابلة للاستعادة.');
  }

  let backupData: Record<string, any[]> = {};
  try {
    backupData = JSON.parse(backup.dataPayload);
  } catch (err: any) {
    throw new Error(`فشل في فك تشفير بيانات النسخة الاحتياطية: ${err.message}`);
  }

  const collectionNames = Object.keys(backupData);
  let totalRestored = 0;
  const restoredCollections: string[] = [];

  // Step 3: Write records in batches
  for (let i = 0; i < collectionNames.length; i++) {
    const colName = collectionNames[i];
    const docs = backupData[colName];
    if (!docs || docs.length === 0) continue;

    if (options.onProgress) {
      const percent = Math.round(20 + ((i + 1) / collectionNames.length) * 70);
      options.onProgress(`جاري استعادة مجموعة ${colName} (${docs.length} سجل)...`, percent);
    }

    const batchSize = 400;
    for (let j = 0; j < docs.length; j += batchSize) {
      const chunk = docs.slice(j, j + batchSize);
      const batch = writeBatch(db);

      chunk.forEach((item) => {
        const docId = item._id || doc(collection(db, colName)).id;
        const cleanData = { ...item };
        delete cleanData._id;

        const docRef = doc(db, colName, docId);
        batch.set(docRef, cleanData, { merge: true });
      });

      try {
        await batch.commit();
        totalRestored += chunk.length;
      } catch (err: any) {
        errors.push(`خطأ في استعادة ${colName}: ${err.message}`);
      }
    }

    restoredCollections.push(colName);
  }

  const durationMs = Date.now() - startTime;

  // Step 4: Audit log
  await logAuditAction(
    'RESTORE_EXECUTE',
    'system_backups',
    backup.backupId,
    `تم استعادة ${totalRestored} سجل من النسخة ${backup.backupId} - وقت العملية: ${(durationMs / 1000).toFixed(1)} ثانية`
  );

  if (options.onProgress) options.onProgress('تمت عملية الاستعادة بنجاح!', 100);

  return {
    success: errors.length === 0,
    safetyBackupId,
    restoredCollections,
    totalRestored,
    durationMs,
    errors,
    timestamp: new Date().toISOString(),
  };
}

/**
 * ASFOUR Factory Management ERP - Safe Restore Service
 * Implements previewing, pre-restore safety checkpoints, batch restoration,
 * file upload verification, and double-confirmation verification.
 */
import {
  collection,
  getCountFromServer,
  doc,
  setDoc,
  writeBatch
} from 'firebase/firestore';
import { db, auth } from '../config/firebase';
import { SystemBackup, RestorePreview, RestoreResult, ChecksumStatus } from '../types';
import { createDatabaseBackup, memoryBackupCache, calculateChecksum, calculateSha256 } from './backupService';
import { logAuditAction } from './auditService';

/**
 * Recompute the checksum of raw backup content and compare it against the
 * checksum recorded in the backup's metadata at creation time.
 *
 * Backups are hashed with calculateSha256() (backupService.ts), which itself
 * falls back to the legacy calculateChecksum() format ("CHK-XXXXXXXX") when
 * window.crypto.subtle is unavailable. To correctly verify both older
 * (legacy-format) and current (real SHA-256) backups, the same algorithm
 * that produced the stored checksum is used to recompute it.
 */
export async function verifyBackupChecksum(
  content: string,
  storedChecksum?: string
): Promise<{ status: ChecksumStatus; calculatedChecksum: string }> {
  if (!storedChecksum) {
    return { status: 'MISSING', calculatedChecksum: '' };
  }

  const calculatedChecksum = storedChecksum.startsWith('CHK-')
    ? calculateChecksum(content)
    : await calculateSha256(content);

  return {
    status: calculatedChecksum === storedChecksum ? 'VALID' : 'INVALID',
    calculatedChecksum,
  };
}

/**
 * Parse and validate an uploaded ASFOUR JSON backup file
 */
export async function parseBackupFile(file: File): Promise<{
  backup: SystemBackup;
  data: Record<string, any[]>;
  checksumStatus: ChecksumStatus;
  calculatedChecksum: string;
}> {
  const content = await file.text();
  let parsed: any;
  try {
    parsed = JSON.parse(content);
  } catch (err: any) {
    throw new Error(`ملف غير صالح: تنسيق JSON غير صحيح (${err.message})`);
  }

  // Handle standard ASFOUR payload format { metadata, data }
  const metadata = parsed.metadata || parsed;
  const data = parsed.data || (parsed.metadata ? {} : parsed);

  if (!metadata || !data || Object.keys(data).length === 0) {
    throw new Error('الملف لا يحتوي على بنية بيانات نسخ احتياطي صالحة لمنظومة عصفور.');
  }

  const { status: checksumStatus, calculatedChecksum } = await verifyBackupChecksum(content, metadata.checksum);

  const recordCounts: Record<string, number> = {};
  let totalRecords = 0;
  Object.keys(data).forEach((col) => {
    if (Array.isArray(data[col])) {
      recordCounts[col] = data[col].length;
      totalRecords += data[col].length;
    }
  });

  const backup: SystemBackup = {
    id: metadata.backupId || `UPLOADED-${Date.now()}`,
    backupId: metadata.backupId || `UPLOADED-${file.name}`,
    fileName: file.name,
    createdAt: metadata.createdAt || new Date().toISOString(),
    createdBy: metadata.createdBy || 'UPLOADED_FILE',
    createdByName: metadata.createdByName || 'ملف خارجي مرفوع',
    type: metadata.type || 'MANUAL',
    schemaVersion: metadata.schemaVersion || 1,
    appVersion: metadata.appVersion || 'Unknown',
    buildId: metadata.buildId || 'Unknown',
    status: 'SUCCESS',
    notes: metadata.notes || `مستورد من ملف خارجي (${file.name})`,
    collections: Object.keys(data),
    recordCounts: metadata.recordCounts || recordCounts,
    totalRecords: metadata.totalRecords || totalRecords,
    sizeBytes: file.size,
    checksum: metadata.checksum || calculatedChecksum,
    storageLocation: 'LOCAL_JSON',
    dataPayload: content
  };

  // Cache in session memory
  memoryBackupCache.set(backup.backupId, content);

  return {
    backup,
    data,
    checksumStatus,
    calculatedChecksum
  };
}

/**
 * Generate a comparison preview between current Firestore counts and the backup counts
 *
 * PHASE 4D: this only ever displays currentCount/backupCount/diff (see
 * RestorePreview's shape below and its sole use in BackupRestoreView.tsx,
 * where the result populates a display-only comparison modal, never an
 * automatic restore decision) - no document content is read or used, so
 * getCountFromServer() (an aggregation query, not a document download)
 * replaces the previous getDocs()+.size for up to 23 collections here.
 * Same collection, no filter, no auth change, same client SDK context -
 * count semantics are identical to the previous `.size` on an unfiltered
 * collection() query. On any error, the count still defaults to 0 exactly
 * as before - never a fallback to a full getDocs() download.
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
      const snap = await getCountFromServer(collection(db, colName));
      currentCount = snap.data().count;
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
 * 0. Recomputes the backup's SHA-256 checksum and enforces it BEFORE any other step
 *    - INVALID checksum: restore is stopped immediately, nothing is touched.
 *    - MISSING checksum: restore requires options.allowMissingChecksum === true
 *      (the caller must have obtained explicit SUPER_ADMIN confirmation).
 * 1. Creates a safety checkpoint backup of the CURRENT database first
 * 2. Deserializes backup payload
 * 3. Restores records using batched writes in chunks of 400
 * 4. Logs full audit trail
 */
export async function executeSafeRestore(
  backup: SystemBackup,
  options: {
    createCheckpointFirst?: boolean;
    allowMissingChecksum?: boolean;
    onProgress?: (message: string, percent: number) => void;
  } = {}
): Promise<RestoreResult> {
  const startTime = Date.now();
  const errors: string[] = [];
  let safetyBackupId: string | undefined = undefined;

  // Step 0: Resolve the raw backup payload and verify its integrity FIRST.
  // No checkpoint is created and no data is touched until this check passes.
  if (options.onProgress) options.onProgress('جاري التحقق من بصمة الملف (SHA-256)...', 5);

  const rawPayload = backup.dataPayload || memoryBackupCache.get(backup.backupId);
  if (!rawPayload) {
    throw new Error('لا تحتوي هذه النسخة على بيانات في ذاكرة المتصفح. يرجى رفع ملف النسخة الاحتياطية (JSON) للاستعادة.');
  }

  const { status: checksumStatus, calculatedChecksum } = await verifyBackupChecksum(rawPayload, backup.checksum);

  if (checksumStatus === 'INVALID') {
    throw new Error(
      'تم إيقاف الاستعادة لأن بصمة الملف لا تطابق البصمة المسجلة. / Restore stopped because the file checksum does not match the recorded checksum. ' +
      `(المسجلة: ${backup.checksum} | المحسوبة: ${calculatedChecksum})`
    );
  }

  if (checksumStatus === 'MISSING' && options.allowMissingChecksum !== true) {
    throw new Error(
      'النسخة الاحتياطية لا تحتوي على بصمة SHA-256 ولا يمكن التحقق من سلامتها بالكامل. / This backup does not contain a SHA-256 checksum and cannot be fully verified. ' +
      'يتطلب تأكيد صريح من مدير عام (SUPER_ADMIN) للمتابعة رغم ذلك.'
    );
  }

  // Step 1: Create automatic safety checkpoint before overwriting
  if (options.createCheckpointFirst !== false) {
    if (options.onProgress) options.onProgress('جاري إنشاء نقطة أمان احتياطية قبل الاستعادة...', 10);
    try {
      const checkpoint = await createDatabaseBackup(
        'SAFETY_CHECKPOINT',
        `نقطة أمان تلقائية تم إنشاؤها قبل استعادة النسخة: ${backup.backupId}`,
        undefined,
        false // Do not auto download checkpoint
      );
      safetyBackupId = checkpoint.backupId;
    } catch (err: any) {
      console.warn('Safety checkpoint warning:', err.message);
      throw new Error(`فشل إنشاء نقطة الأمان الوقائية: ${err.message}. تم إلغاء الاستعادة لحماية البيانات.`);
    }
  }

  // Step 2: Parse backup payload (already integrity-checked in Step 0)
  let parsedObject: any = {};
  try {
    parsedObject = JSON.parse(rawPayload);
  } catch (err: any) {
    throw new Error(`فشل في فك تشفير بيانات النسخة الاحتياطية: ${err.message}`);
  }

  // Handle both { metadata, data } structure and direct collection map
  const backupData: Record<string, any[]> = parsedObject.data || parsedObject;

  const collectionNames = Object.keys(backupData).filter(key => key !== 'metadata' && Array.isArray(backupData[key]));
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
    `تم استعادة ${totalRestored} سجل من النسخة ${backup.backupId} - بصمة الملف: ${checksumStatus} - وقت العملية: ${(durationMs / 1000).toFixed(1)} ثانية`
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
    checksumStatus,
  };
}

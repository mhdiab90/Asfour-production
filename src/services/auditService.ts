/**
 * Audit Logging Service
 * Records administrative and operational actions to the `auditLogs` collection in Firestore.
 */
import { collection, addDoc, serverTimestamp, query, orderBy, limit, getDocs, onSnapshot, where } from 'firebase/firestore';
import { db, auth, handleFirestoreError, OperationType } from '../config/firebase';
import { AuditLog } from '../types';

export async function logAuditAction(
  action: AuditLog['action'],
  targetCollection: string,
  documentId?: string,
  details?: string
): Promise<void> {
  const currentUser = auth.currentUser;
  if (!currentUser) return;

  const logPayload = {
    userId: currentUser.uid,
    username: currentUser.email || 'Admin',
    action,
    collection: targetCollection,
    documentId: documentId || '',
    details: details || '',
    timestamp: new Date().toISOString(),
    serverTime: serverTimestamp(),
  };

  try {
    await addDoc(collection(db, 'auditLogs'), logPayload);
  } catch (error) {
    console.warn('Audit log write warning:', error);
    // Audit log should not block main operation, but record in console
  }
}

export async function fetchRecentAuditLogs(maxCount = 100): Promise<AuditLog[]> {
  try {
    const q = query(collection(db, 'auditLogs'), orderBy('timestamp', 'desc'), limit(maxCount));
    const snapshot = await getDocs(q);
    return snapshot.docs.map(doc => ({
      id: doc.id,
      ...(doc.data() as Omit<AuditLog, 'id'>)
    }));
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'auditLogs');
  }
}

/**
 * Master Data Edit History (§17/§28) - reuses the EXISTING auditLogs
 * collection (every masterDataService/productTypeService mutation already
 * writes here) rather than a new collection/schema. Deliberately a single
 * equality `where` (auto-indexed by Firestore with no composite index setup
 * required) + client-side collection-match + sort, instead of a compound
 * server-side query, so this needs no Firestore config changes.
 */
export async function fetchAuditLogsForDocument(targetCollection: string, documentId: string, maxCount = 50): Promise<AuditLog[]> {
  if (!documentId) return [];
  try {
    const q = query(collection(db, 'auditLogs'), where('documentId', '==', documentId), limit(200));
    const snapshot = await getDocs(q);
    return snapshot.docs
      .map((doc) => ({ id: doc.id, ...(doc.data() as Omit<AuditLog, 'id'>) }))
      .filter((log) => log.collection === targetCollection)
      .sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''))
      .slice(0, maxCount);
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'auditLogs');
    return [];
  }
}

export function subscribeAuditLogs(
  onUpdate: (logs: AuditLog[]) => void,
  onError?: (err: any) => void,
  maxCount = 100
): () => void {
  const q = query(collection(db, 'auditLogs'), orderBy('timestamp', 'desc'), limit(maxCount));
  return onSnapshot(
    q,
    (snapshot) => {
      const logs = snapshot.docs.map((d) => ({
        id: d.id,
        ...d.data(),
      })) as AuditLog[];
      onUpdate(logs);
    },
    (err) => {
      if (onError) onError(err);
    }
  );
}


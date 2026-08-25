/**
 * User Management Service
 * Handles user provisioning, Firebase Auth user creation without session collision,
 * employee linking, deterministic UID document storage in adminUsers/{uid},
 * activation toggling, and Firebase Auth password reset.
 */
import { initializeApp, deleteApp } from 'firebase/app';
import { 
  getAuth, 
  createUserWithEmailAndPassword, 
  signOut as secondarySignOut,
  sendPasswordResetEmail
} from 'firebase/auth';
import { 
  collection, 
  doc, 
  getDocs, 
  getDoc, 
  setDoc, 
  updateDoc, 
  deleteDoc, 
  onSnapshot, 
  query, 
  orderBy, 
  serverTimestamp 
} from 'firebase/firestore';
import { db, auth, firebaseConfig, handleFirestoreError, OperationType } from '../config/firebase';
import { AdminUser, CreateUserPayload, UpdateUserPayload } from '../types';
import { logAuditAction } from './auditService';
import { SECURITY_ADMIN_EMAIL } from '../context/AuthContext';

/**
 * Fetch all users from adminUsers collection.
 */
export async function fetchAllUsers(): Promise<AdminUser[]> {
  try {
    const q = query(collection(db, 'adminUsers'), orderBy('createdAt', 'desc'));
    const snapshot = await getDocs(q);
    return snapshot.docs.map((docSnap) => ({
      uid: docSnap.id,
      ...docSnap.data(),
    })) as AdminUser[];
  } catch (error) {
    // Fallback if index isn't created yet
    try {
      const snapshot = await getDocs(collection(db, 'adminUsers'));
      return snapshot.docs.map((docSnap) => ({
        uid: docSnap.id,
        ...docSnap.data(),
      })) as AdminUser[];
    } catch (fallbackErr) {
      handleFirestoreError(fallbackErr, OperationType.LIST, 'adminUsers');
      return [];
    }
  }
}

/**
 * Subscribe to real-time updates of the adminUsers collection.
 */
export function subscribeUsers(
  onData: (users: AdminUser[]) => void,
  onError?: (err: any) => void
) {
  return onSnapshot(
    collection(db, 'adminUsers'),
    (snapshot) => {
      const users = snapshot.docs.map((docSnap) => ({
        uid: docSnap.id,
        ...docSnap.data(),
      })) as AdminUser[];

      // Sort by creation date descending
      users.sort((a, b) => {
        const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return timeB - timeA;
      });

      onData(users);
    },
    (error) => {
      console.error('Error subscribing to users:', error);
      if (onError) onError(error);
    }
  );
}

/**
 * Create a new Firebase Authentication user and link to an Employee in Firestore adminUsers/{uid}.
 * Uses a secondary isolated Firebase App so the current Super Admin session is not interrupted.
 */
export async function createSystemUser(payload: CreateUserPayload): Promise<AdminUser> {
  const email = payload.email.trim().toLowerCase();
  const password = payload.password;

  if (!email || !password) {
    throw new Error('يرجى إدخال البريد الإلكتروني وكلمة المرور.');
  }

  if (password.length < 6) {
    throw new Error('كلمة المرور يجب أن لا تقل عن 6 أحرف أو أرقام.');
  }

  // 1. Create Firebase Auth user via secondary app instance
  const tempAppName = `UserCreationApp_${Date.now()}_${Math.random().toString(36).substring(7)}`;
  const secondaryApp = initializeApp(firebaseConfig, tempAppName);
  const secondaryAuth = getAuth(secondaryApp);

  let newUid = '';

  try {
    const userCredential = await createUserWithEmailAndPassword(secondaryAuth, email, password);
    newUid = userCredential.user.uid;
    // Sign out from the temporary secondary auth instance immediately
    await secondarySignOut(secondaryAuth);
  } catch (authError: any) {
    if (authError.code === 'auth/email-already-in-use') {
      throw new Error(`البريد الإلكتروني (${email}) مسجل بالفعل في نظام Firebase Authentication.`);
    } else if (authError.code === 'auth/invalid-email') {
      throw new Error('صيغة البريد الإلكتروني غير صالحة.');
    } else if (authError.code === 'auth/weak-password') {
      throw new Error('كلمة المرور ضعيفة جداً. يرجى اختيار كلمة مرور أقوى.');
    }
    throw new Error(authError.message || 'فشل إنشاء المستخدم في Firebase Authentication.');
  } finally {
    // Cleanup temporary secondary app to avoid memory leak
    try {
      await deleteApp(secondaryApp);
    } catch {
      // Ignore cleanup error
    }
  }

  // 2. Prepare Firestore user document
  const username = payload.username || (payload.employeeCode ? payload.employeeCode : email.split('@')[0]);
  const fullName = payload.fullName || payload.employeeName || (payload.role === 'PRODUCTION_USER' ? 'مشغل إنتاج' : 'مستخدم نظام');

  const nowIso = new Date().toISOString();
  const userDocData: AdminUser = {
    uid: newUid,
    email: email,
    username: username,
    role: payload.role || 'PRODUCTION_USER',
    active: payload.active !== undefined ? payload.active : true,
    fullName: fullName,
    employeeId: payload.employeeId || '',
    employeeCode: payload.employeeCode || '',
    employeeName: payload.employeeName || '',
    operatorStation: payload.operatorStation || '',
    permissions: payload.permissions || {},
    createdBy: auth.currentUser?.uid || 'SUPER_ADMIN',
    createdByName: auth.currentUser?.email || 'المشرف العام',
    createdAt: nowIso,
    updatedAt: nowIso,
  };

  // 3. Write document to adminUsers/{newUid}
  try {
    const docRef = doc(db, 'adminUsers', newUid);
    await setDoc(docRef, {
      ...userDocData,
      serverCreatedAt: serverTimestamp(),
      serverUpdatedAt: serverTimestamp(),
    });

    await logAuditAction(
      'CREATE_USER',
      'adminUsers',
      newUid,
      `إنشاء حساب مستخدم جديد: ${fullName} (${email}) - الدور: ${payload.role} - مرتبط بالعامل: ${payload.employeeName || 'غير مرتبط'}`
    );

    return userDocData;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `adminUsers/${newUid}`);
    throw error;
  }
}

/**
 * Update user details in adminUsers/{uid}.
 */
export async function updateSystemUser(uid: string, payload: UpdateUserPayload): Promise<void> {
  try {
    const docRef = doc(db, 'adminUsers', uid);
    const updateData: Record<string, any> = {
      ...payload,
      updatedAt: new Date().toISOString(),
      serverUpdatedAt: serverTimestamp(),
    };

    // Remove undefined values
    Object.keys(updateData).forEach(
      (key) => updateData[key] === undefined && delete updateData[key]
    );

    await updateDoc(docRef, updateData);

    await logAuditAction(
      'UPDATE_USER',
      'adminUsers',
      uid,
      `تحديث بيانات المستخدم: ${payload.fullName || uid} - الدور: ${payload.role || 'بدون تغيير'}`
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `adminUsers/${uid}`);
    throw error;
  }
}

/**
 * Update granular permissions for a user with audit logging and history tracking.
 */
export async function updateUserPermissions(
  uid: string,
  permissions: any,
  reason?: string,
  userMetadata?: { employeeId?: string; employeeName?: string; email?: string }
): Promise<void> {
  try {
    const docRef = doc(db, 'adminUsers', uid);
    const snap = await getDoc(docRef);
    const oldUserData = snap.exists() ? snap.data() : {};
    const oldPermissions = oldUserData.permissions || {};

    const sanitizedPermissions: Record<string, any> = {};
    if (permissions && typeof permissions === 'object') {
      Object.entries(permissions).forEach(([k, v]) => {
        if (v !== undefined && v !== null) {
          if (Array.isArray(v)) {
            sanitizedPermissions[k] = v.filter(x => typeof x === 'string' && x.trim().length > 0);
          } else if (typeof v === 'boolean' || typeof v === 'string' || typeof v === 'number') {
            sanitizedPermissions[k] = v;
          }
        }
      });
    }
    sanitizedPermissions.permissionSchemaVersion = 2;

    const nowIso = new Date().toISOString();
    const currentUid = auth.currentUser?.uid || 'SUPER_ADMIN';
    const currentEmail = auth.currentUser?.email || 'المشرف العام';

    await updateDoc(docRef, {
      permissions: sanitizedPermissions,
      updatedAt: nowIso,
      serverUpdatedAt: serverTimestamp(),
    });

    // Write to permissionAuditLogs
    try {
      const auditLogRef = doc(collection(db, 'permissionAuditLogs'));
      await setDoc(auditLogRef, {
        id: auditLogRef.id,
        userId: uid,
        employeeId: userMetadata?.employeeId || oldUserData.employeeId || '',
        employeeName: userMetadata?.employeeName || oldUserData.employeeName || oldUserData.fullName || '',
        userEmail: userMetadata?.email || oldUserData.email || '',
        changedBy: currentUid,
        changedByName: currentEmail,
        timestamp: nowIso,
        oldPermissions: oldPermissions,
        newPermissions: sanitizedPermissions,
        reason: reason || 'تحديث الصلاحيات التفصيلية للمستخدم',
        serverCreatedAt: serverTimestamp(),
      });
    } catch (auditErr) {
      console.warn('Could not write to permissionAuditLogs collection:', auditErr);
    }

    await logAuditAction(
      'UPDATE_USER',
      'adminUsers',
      uid,
      `تحديث الصلاحيات التفصيلية للمستخدم: ${userMetadata?.email || oldUserData.email || uid} - السبب: ${reason || 'تعديل الصلاحيات المخصصة'}`
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `adminUsers/${uid}`);
    throw error;
  }
}

/**
 * Toggle Active / Inactive status for a user.
 */
export async function toggleUserActive(uid: string, currentActive: boolean, userEmail?: string): Promise<void> {
  // Protect primary Super Admin
  if (userEmail && userEmail.toLowerCase() === SECURITY_ADMIN_EMAIL.toLowerCase()) {
    throw new Error('لا يمكن تعطيل حساب المشرف العام الرئيسي للنظام.');
  }

  const newStatus = !currentActive;
  try {
    const docRef = doc(db, 'adminUsers', uid);
    await updateDoc(docRef, {
      active: newStatus,
      updatedAt: new Date().toISOString(),
      serverUpdatedAt: serverTimestamp(),
    });

    await logAuditAction(
      newStatus ? 'ACTIVATE_USER' : 'DEACTIVATE_USER',
      'adminUsers',
      uid,
      `${newStatus ? 'تفعيل' : 'تعطيل'} حساب المستخدم: ${userEmail || uid}`
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `adminUsers/${uid}`);
    throw error;
  }
}

/**
 * Delete user authorization record from adminUsers/{uid}.
 */
export async function deleteSystemUser(uid: string, userEmail?: string): Promise<void> {
  // Protect primary Super Admin
  if (userEmail && userEmail.toLowerCase() === SECURITY_ADMIN_EMAIL.toLowerCase()) {
    throw new Error('حساب المشرف العام الرئيسي محمي ولا يمكن حذفه.');
  }

  try {
    const docRef = doc(db, 'adminUsers', uid);
    await deleteDoc(docRef);

    await logAuditAction(
      'DELETE_USER',
      'adminUsers',
      uid,
      `حذف صلاحيات المستخدم: ${userEmail || uid}`
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `adminUsers/${uid}`);
    throw error;
  }
}

/**
 * Send password reset email to user via Firebase Authentication.
 */
export async function sendUserPasswordReset(email: string): Promise<void> {
  const trimmed = email.trim();
  if (!trimmed) {
    throw new Error('البريد الإلكتروني غير متوفر لإرسال رابط إعادة التعيين.');
  }

  try {
    await sendPasswordResetEmail(auth, trimmed);
    await logAuditAction(
      'PASSWORD_RESET_REQUESTED',
      'auth',
      trimmed,
      `إرسال بريد إعادة تعيين كلمة المرور إلى: ${trimmed}`
    );
  } catch (error: any) {
    if (error.code === 'auth/user-not-found') {
      throw new Error('هذا البريد الإلكتروني غير مسجل في Firebase Authentication.');
    } else if (error.code === 'auth/invalid-email') {
      throw new Error('صيغة البريد الإلكتروني غير صالحة.');
    }
    throw new Error(error.message || 'تعذر إرسال بريد إعادة تعيين كلمة المرور.');
  }
}

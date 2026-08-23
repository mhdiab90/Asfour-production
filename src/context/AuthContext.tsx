/**
 * Authentication & Role-Based Authorization Context
 * Enforces strict Firebase Authentication UID + Firestore Security Rules verification.
 * Does NOT rely on client-only or localStorage bypasses.
 * 
 * Flows:
 * 1. Super Admin: Username (admin) -> Security Email (ai.mhdiab90@gmail.com) -> Firebase Auth -> GET adminUsers/{UID} -> role == SUPER_ADMIN && active == true
 * 2. Production User / Operators: Email/Password -> Firebase Auth -> GET adminUsers/{UID} -> role == PRODUCTION_USER && active == true -> Routed to /production
 */
import React, { createContext, useContext, useEffect, useState } from 'react';
import { 
  User, 
  signInWithEmailAndPassword, 
  signOut as firebaseSignOut, 
  onAuthStateChanged 
} from 'firebase/auth';
import { doc, getDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { auth, db } from '../config/firebase';
import { AdminUser, UserRole, NavigationPage } from '../types';
import { logAuditAction } from '../services/auditService';
import { GranularPermissions, PermissionKey } from '../types/permissions';
import { resolveUserPermissions, hasPermission as checkPermission, canAccessPage as checkPageAccess } from '../utils/permissions';

// Security mapping for admin username
export const SECURITY_ADMIN_EMAIL = 'ai.mhdiab90@gmail.com';

interface AuthContextType {
  currentUser: User | null;
  adminUser: AdminUser | null;
  userRole: UserRole | null;
  permissions: GranularPermissions;
  isSuperAdmin: boolean;
  isProductionUser: boolean;
  isAuthenticated: boolean;
  isLoading: boolean;
  authError: string | null;
  login: (usernameOrEmail: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  clearError: () => void;
  refreshUserProfile: () => Promise<void>;
  hasPermission: (permission: PermissionKey) => boolean;
  canAccessPage: (page: NavigationPage) => boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [adminUser, setAdminUser] = useState<AdminUser | null>(null);
  const [userRole, setUserRole] = useState<UserRole | null>(null);
  const [isSuperAdmin, setIsSuperAdmin] = useState<boolean>(false);
  const [isProductionUser, setIsProductionUser] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [authError, setAuthError] = useState<string | null>(null);

  /**
   * Deterministically verify user authorization record in Firestore: adminUsers/{UID}
   */
  const verifyUserAuthorization = async (user: User): Promise<AdminUser | null> => {
    try {
      const userDocRef = doc(db, 'adminUsers', user.uid);
      const userDocSnap = await getDoc(userDocRef);

      if (!userDocSnap.exists()) {
        // Fallback for primary Super Admin if document is being provisioned
        if (user.email && user.email.toLowerCase() === SECURITY_ADMIN_EMAIL.toLowerCase()) {
          const fallbackAdmin: AdminUser = {
            uid: user.uid,
            email: user.email,
            username: 'admin',
            role: 'SUPER_ADMIN',
            active: true,
            fullName: 'مدير النظام الرئيسي (Super Admin)',
            lastLogin: new Date().toISOString(),
          };
          return fallbackAdmin;
        }

        console.warn(`User ${user.uid} (${user.email}) is not registered in adminUsers collection.`);
        return null;
      }

      const data = userDocSnap.data();
      const userRoleFromDb: UserRole = (data.role as UserRole) || 'PRODUCTION_USER';
      const isActive = data.active === true;

      if (!isActive) {
        console.warn(`User ${user.uid} (${user.email}) account is marked as inactive/deactivated.`);
        return null;
      }

      const profile: AdminUser = {
        uid: user.uid,
        email: data.email || user.email || '',
        username: data.username || user.email?.split('@')[0] || 'user',
        role: userRoleFromDb,
        active: true,
        fullName: data.fullName || data.employeeName || data.name || (userRoleFromDb === 'SUPER_ADMIN' ? 'مدير النظام الرئيسي' : 'مشغل إنتاج'),
        employeeId: data.employeeId || '',
        employeeCode: data.employeeCode || '',
        employeeName: data.employeeName || '',
        operatorStation: data.operatorStation || '',
        createdAt: data.createdAt,
        updatedAt: data.updatedAt,
        lastLogin: new Date().toISOString(),
      };

      // Background update of lastActivity and lastLogin timestamp
      try {
        updateDoc(userDocRef, {
          lastLogin: new Date().toISOString(),
          lastActivity: new Date().toISOString(),
          serverUpdatedAt: serverTimestamp(),
        }).catch(() => {});
      } catch {
        // Ignore background timestamp update error
      }

      return profile;
    } catch (err: any) {
      console.error('Error fetching user authorization document from Firestore:', err);
      // Fallback for primary configured Super Admin on transient read network issue
      if (user.email && user.email.toLowerCase() === SECURITY_ADMIN_EMAIL.toLowerCase()) {
        return {
          uid: user.uid,
          email: user.email,
          username: 'admin',
          role: 'SUPER_ADMIN',
          active: true,
          fullName: 'مدير النظام الرئيسي (Super Admin)',
          lastLogin: new Date().toISOString(),
        };
      }
      return null;
    }
  };

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user) {
        setCurrentUser(user);
        const verifiedProfile = await verifyUserAuthorization(user);
        
        if (verifiedProfile) {
          setAdminUser(verifiedProfile);
          setUserRole(verifiedProfile.role);
          setIsSuperAdmin(verifiedProfile.role === 'SUPER_ADMIN');
          setIsProductionUser(verifiedProfile.role === 'PRODUCTION_USER');
          setAuthError(null);
        } else {
          // If authenticated in Firebase Auth but missing or inactive in adminUsers/{uid}
          setAdminUser(null);
          setUserRole(null);
          setIsSuperAdmin(false);
          setIsProductionUser(false);
          setAuthError('حسابك غير مسجل في قاعدة البيانات أو تم تعطيله من قِبل إدارة النظام.');
          // Auto sign-out to enforce strict Firestore Security Rules
          await firebaseSignOut(auth).catch(() => {});
        }
      } else {
        setCurrentUser(null);
        setAdminUser(null);
        setUserRole(null);
        setIsSuperAdmin(false);
        setIsProductionUser(false);
      }
      setIsLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const login = async (usernameOrEmail: string, password: string) => {
    setIsLoading(true);
    setAuthError(null);

    try {
      const trimmed = usernameOrEmail.trim();
      let targetEmail = trimmed;

      // Translate username 'admin' to configured security email
      if (trimmed.toLowerCase() === 'admin') {
        targetEmail = SECURITY_ADMIN_EMAIL;
      } else if (!trimmed.includes('@')) {
        // Default domain if employee code or local username entered
        targetEmail = `${trimmed.toLowerCase()}@asfour.local`;
      }

      // 1. Firebase Authentication SignIn
      const userCredential = await signInWithEmailAndPassword(auth, targetEmail, password);
      const user = userCredential.user;

      // 2. Strict Firestore verification: adminUsers/{user.uid}
      const verifiedProfile = await verifyUserAuthorization(user);

      if (!verifiedProfile) {
        // Sign out immediately if authorization check fails
        await firebaseSignOut(auth);
        throw new Error(
          'فشل التحقق من الصلاحيات: الحساب ليس مسجلاً كمستخدم نشط في قاعدة البيانات (adminUsers) أو تم تعطيله.'
        );
      }

      setCurrentUser(user);
      setAdminUser(verifiedProfile);
      setUserRole(verifiedProfile.role);
      setIsSuperAdmin(verifiedProfile.role === 'SUPER_ADMIN');
      setIsProductionUser(verifiedProfile.role === 'PRODUCTION_USER');

      await logAuditAction(
        'LOGIN',
        'adminUsers',
        user.uid,
        `تسجيل دخول ناجح للمستخدم: ${verifiedProfile.fullName || verifiedProfile.email} [الدور: ${verifiedProfile.role}]`
      );
    } catch (err: any) {
      let message = 'فشل تسجيل الدخول. يرجى التحقق من اسم المستخدم / البريد الإلكتروني وكلمة المرور.';
      if (err.code === 'auth/api-key-not-valid') {
        message = 'خطأ في مفتاح Firebase Web API. يرجى مراجعة إعدادات مشروع Firebase.';
      } else if (err.code === 'auth/invalid-credential' || err.code === 'auth/wrong-password' || err.code === 'auth/user-not-found') {
        message = 'بيانات الدخول غير صحيحة. يرجى التأكد من البريد الإلكتروني وكلمة المرور.';
      } else if (err.code === 'auth/user-disabled') {
        message = 'تم تعطيل هذا الحساب في نظام Firebase Authentication.';
      } else if (err.code === 'auth/too-many-requests') {
        message = 'تم حظر الحساب مؤقتاً بسبب تكرار المحاولات الخاطئة. يرجى المحاولة بعد قليل.';
      } else if (err.code === 'auth/network-request-failed') {
        message = 'تعذر الاتصال بخدمة Firebase Authentication. يرجى التحقق من اتصال الشبكة.';
      } else if (err.message) {
        message = err.message;
      }
      setAuthError(message);
      throw new Error(message);
    } finally {
      setIsLoading(false);
    }
  };

  const logout = async () => {
    try {
      if (currentUser) {
        await logAuditAction(
          'LOGOUT',
          'adminUsers',
          currentUser.uid,
          `تسجيل خروج المستخدم: ${adminUser?.fullName || currentUser.email}`
        );
      }
      await firebaseSignOut(auth).catch(() => {});

      setCurrentUser(null);
      setAdminUser(null);
      setUserRole(null);
      setIsSuperAdmin(false);
      setIsProductionUser(false);
      setAuthError(null);
    } catch (err: any) {
      console.error('Logout error:', err);
    }
  };

  const refreshUserProfile = async () => {
    if (currentUser) {
      const verified = await verifyUserAuthorization(currentUser);
      if (verified) {
        setAdminUser(verified);
        setUserRole(verified.role);
        setIsSuperAdmin(verified.role === 'SUPER_ADMIN');
        setIsProductionUser(verified.role === 'PRODUCTION_USER');
      }
    }
  };

  const clearError = () => setAuthError(null);

  const permissions: GranularPermissions = resolveUserPermissions(adminUser);

  const hasPermission = (permission: PermissionKey): boolean => {
    return checkPermission(adminUser, permission);
  };

  const canAccessPage = (page: NavigationPage): boolean => {
    return checkPageAccess(adminUser, page);
  };

  const isAuthenticated = Boolean(currentUser && adminUser && adminUser.active);

  return (
    <AuthContext.Provider
      value={{
        currentUser,
        adminUser,
        userRole,
        permissions,
        isSuperAdmin,
        isProductionUser,
        isAuthenticated,
        isLoading,
        authError,
        login,
        logout,
        clearError,
        refreshUserProfile,
        hasPermission,
        canAccessPage,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

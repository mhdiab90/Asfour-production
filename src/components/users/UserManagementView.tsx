/**
 * SUPER_ADMIN User Management Screen
 * Complete interface for creating, managing, linking, activating, and deactivating
 * Firebase Authentication users and Granular Permissions in Firestore adminUsers/{uid}.
 */
import React, { useState, useEffect, useMemo } from 'react';
import { 
  Users, 
  UserPlus, 
  Search, 
  ShieldCheck, 
  Cpu, 
  CheckCircle2, 
  XCircle, 
  Mail, 
  Key, 
  Lock, 
  RefreshCw, 
  Trash2, 
  Edit3, 
  Building, 
  Clock, 
  AlertCircle, 
  Filter, 
  Eye, 
  EyeOff,
  UserCheck,
  MapPin,
  ExternalLink,
  ChevronDown,
  User,
  Sliders,
  Sparkles
} from 'lucide-react';
import { 
  AdminUser, 
  Employee, 
  UserRole, 
  CreateUserPayload, 
  UpdateUserPayload, 
  NavigationPage 
} from '../../types';
import { GranularPermissions } from '../../types/permissions';
import { 
  subscribeUsers, 
  createSystemUser, 
  updateSystemUser, 
  toggleUserActive, 
  deleteSystemUser, 
  sendUserPasswordReset 
} from '../../services/userService';
import { fetchMasterData } from '../../services/masterDataService';
import { useAuth, SECURITY_ADMIN_EMAIL } from '../../context/AuthContext';
import { Badge } from '../common/Badge';
import { Modal } from '../common/Modal';
import { formatDateTime, formatDate, toWesternDigits } from '../../utils/formatters';
import { GranularPermissionEditor } from './GranularPermissionEditor';
import { ROLE_PRESET_MAP, resolveUserPermissions, countActivePermissions } from '../../utils/permissions';
import { useLanguage } from '../../i18n/LanguageContext';

interface UserManagementViewProps {
  onNavigate: (page: NavigationPage) => void;
}

export const UserManagementView: React.FC<UserManagementViewProps> = ({ onNavigate }) => {
  const { adminUser: currentAdminUser } = useAuth();
  const { language, isRtl, t } = useLanguage();

  // Users and Master Data state
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [actionSuccessMessage, setActionSuccessMessage] = useState<string | null>(null);
  const [actionErrorMessage, setActionErrorMessage] = useState<string | null>(null);

  // Filters & Search
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [roleFilter, setRoleFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');

  // Create User Modal State
  const [isCreateModalOpen, setIsCreateModalOpen] = useState<boolean>(false);
  const [createActiveTab, setCreateActiveTab] = useState<'info' | 'permissions'>('info');
  const [createEmail, setCreateEmail] = useState<string>('');
  const [createPassword, setCreatePassword] = useState<string>('');
  const [showCreatePassword, setShowCreatePassword] = useState<boolean>(false);
  const [createRole, setCreateRole] = useState<UserRole>('PRODUCTION_OPERATOR');
  const [createPermissions, setCreatePermissions] = useState<GranularPermissions>(ROLE_PRESET_MAP.PRODUCTION_OPERATOR);
  const [createEmployeeId, setCreateEmployeeId] = useState<string>('');
  const [createStation, setCreateStation] = useState<string>('');
  const [createActive, setCreateActive] = useState<boolean>(true);
  const [isCreating, setIsCreating] = useState<boolean>(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Edit User Modal State
  const [isEditModalOpen, setIsEditModalOpen] = useState<boolean>(false);
  const [editActiveTab, setEditActiveTab] = useState<'info' | 'permissions'>('info');
  const [editingUser, setEditingUser] = useState<AdminUser | null>(null);
  const [editRole, setEditRole] = useState<UserRole>('PRODUCTION_OPERATOR');
  const [editPermissions, setEditPermissions] = useState<GranularPermissions>(ROLE_PRESET_MAP.PRODUCTION_OPERATOR);
  const [editEmployeeId, setEditEmployeeId] = useState<string>('');
  const [editStation, setEditStation] = useState<string>('');
  const [editActive, setEditActive] = useState<boolean>(true);
  const [isUpdating, setIsUpdating] = useState<boolean>(false);
  const [editError, setEditError] = useState<string | null>(null);

  // Delete Confirm State
  const [deleteTargetUser, setDeleteTargetUser] = useState<AdminUser | null>(null);
  const [isDeleting, setIsDeleting] = useState<boolean>(false);

  // Password Reset Prompt State
  const [passwordResetUser, setPasswordResetUser] = useState<AdminUser | null>(null);
  const [isSendingReset, setIsSendingReset] = useState<boolean>(false);

  // Subscribe to Users collection
  useEffect(() => {
    setIsLoading(true);
    const unsubscribe = subscribeUsers(
      (usersList) => {
        setUsers(usersList);
        setIsLoading(false);
      },
      (error) => {
        console.error('Error fetching users:', error);
        setActionErrorMessage(language === 'ar' ? 'تعذر تحميل قائمة المستخدمين من قاعدة البيانات.' : 'Could not fetch user accounts.');
        setIsLoading(false);
      }
    );

    // Load active employees list for linking
    fetchMasterData<Employee>('employees')
      .then((empList) => setEmployees(empList.filter((e) => e.active !== false)))
      .catch((err) => console.warn('Could not load employees list for linking:', err));

    return () => unsubscribe();
  }, [language]);

  // Quick auto-dismiss for alerts
  useEffect(() => {
    if (actionSuccessMessage) {
      const timer = setTimeout(() => setActionSuccessMessage(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [actionSuccessMessage]);

  // Handle Employee selection in Create modal to auto-suggest email & name
  const handleEmployeeSelection = (employeeId: string) => {
    setCreateEmployeeId(employeeId);
    if (!employeeId) return;

    const selectedEmp = employees.find((e) => e.id === employeeId);
    if (selectedEmp) {
      if (!createEmail) {
        const cleanCode = selectedEmp.code.toLowerCase().replace(/[^a-z0-9]/g, '');
        setCreateEmail(`operator_${cleanCode}@asfour.local`);
      }
      if (!createStation && selectedEmp.departmentName) {
        setCreateStation(selectedEmp.departmentName);
      }
    }
  };

  const handleCreateRoleChange = (newRole: UserRole) => {
    setCreateRole(newRole);
    if (ROLE_PRESET_MAP[newRole]) {
      setCreatePermissions({ ...ROLE_PRESET_MAP[newRole] });
    }
  };

  const handleEditRoleChange = (newRole: UserRole) => {
    setEditRole(newRole);
    if (ROLE_PRESET_MAP[newRole]) {
      setEditPermissions({ ...ROLE_PRESET_MAP[newRole] });
    }
  };

  // Submit Create User
  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateError(null);

    const email = createEmail.trim();
    const password = createPassword.trim();

    if (!email || !password) {
      setCreateError(language === 'ar' ? 'يرجى ملء البريد الإلكتروني وكلمة المرور.' : 'Email and password are required.');
      return;
    }

    if (password.length < 6) {
      setCreateError(language === 'ar' ? 'كلمة المرور يجب أن لا تقل عن 6 أحرف/أرقام.' : 'Password must be at least 6 characters.');
      return;
    }

    const selectedEmp = employees.find((e) => e.id === createEmployeeId);

    const payload: CreateUserPayload = {
      email,
      password,
      role: createRole,
      active: createActive,
      employeeId: selectedEmp?.id || '',
      employeeCode: selectedEmp?.code || '',
      employeeName: selectedEmp?.name || '',
      fullName: selectedEmp?.name || email.split('@')[0],
      operatorStation: createStation.trim(),
      username: selectedEmp?.code || email.split('@')[0],
      permissions: createPermissions,
    };

    setIsCreating(true);
    try {
      await createSystemUser(payload);
      setActionSuccessMessage(language === 'ar' ? `تم إنشاء حساب المستخدم (${email}) بنجاح.` : `User account (${email}) created successfully.`);
      setIsCreateModalOpen(false);
      // Reset form
      setCreateEmail('');
      setCreatePassword('');
      setCreateEmployeeId('');
      setCreateStation('');
      setCreateRole('PRODUCTION_OPERATOR');
      setCreatePermissions(ROLE_PRESET_MAP.PRODUCTION_OPERATOR);
      setCreateActive(true);
      setCreateActiveTab('info');
    } catch (err: any) {
      setCreateError(err.message || 'فشل إنشاء المستخدم.');
    } finally {
      setIsCreating(false);
    }
  };

  // Submit Edit User
  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingUser) return;
    setEditError(null);

    const selectedEmp = employees.find((e) => e.id === editEmployeeId);

    const payload: UpdateUserPayload = {
      role: editRole,
      active: editActive,
      employeeId: selectedEmp?.id || '',
      employeeCode: selectedEmp?.code || '',
      employeeName: selectedEmp?.name || '',
      fullName: selectedEmp?.name || editingUser.fullName || editingUser.email.split('@')[0],
      operatorStation: editStation.trim(),
      permissions: editPermissions,
    };

    setIsUpdating(true);
    try {
      await updateSystemUser(editingUser.uid, payload);
      setActionSuccessMessage(language === 'ar' ? `تم تحديث بيانات وصلاحيات المستخدم (${editingUser.email}) بنجاح.` : `User profile and permissions updated.`);
      setIsEditModalOpen(false);
      setEditingUser(null);
      setEditActiveTab('info');
    } catch (err: any) {
      setEditError(err.message || 'فشل تحديث بيانات المستخدم.');
    } finally {
      setIsUpdating(false);
    }
  };

  // Toggle Active/Inactive status
  const handleToggleStatus = async (user: AdminUser) => {
    try {
      await toggleUserActive(user.uid, user.active, user.email);
      setActionSuccessMessage(
        language === 'ar'
          ? `تم ${user.active ? 'تعطيل' : 'تفعيل'} حساب المستخدم: ${user.fullName || user.email} بنجاح.`
          : `User account ${user.fullName || user.email} was ${user.active ? 'deactivated' : 'activated'}.`
      );
    } catch (err: any) {
      setActionErrorMessage(err.message || 'فشل تغيير حالة المستخدم.');
    }
  };

  // Send Password Reset
  const handleSendPasswordReset = async () => {
    if (!passwordResetUser) return;
    setIsSendingReset(true);
    try {
      await sendUserPasswordReset(passwordResetUser.email);
      setActionSuccessMessage(language === 'ar' ? `تم إرسال رابط إعادة تعيين كلمة المرور إلى: ${passwordResetUser.email}` : `Password reset email sent to ${passwordResetUser.email}`);
      setPasswordResetUser(null);
    } catch (err: any) {
      setActionErrorMessage(err.message || 'تعذر إرسال رابط إعادة التعيين.');
    } finally {
      setIsSendingReset(false);
    }
  };

  // Delete User
  const handleDeleteUser = async () => {
    if (!deleteTargetUser) return;
    setIsDeleting(true);
    try {
      await deleteSystemUser(deleteTargetUser.uid, deleteTargetUser.email);
      setActionSuccessMessage(language === 'ar' ? `تم حذف صلاحيات المستخدم (${deleteTargetUser.email}) بنجاح.` : `User account deleted.`);
      setDeleteTargetUser(null);
    } catch (err: any) {
      setActionErrorMessage(err.message || 'فشل حذف المستخدم.');
    } finally {
      setIsDeleting(false);
    }
  };

  // Open Edit Modal
  const openEditModal = (user: AdminUser) => {
    setEditingUser(user);
    setEditRole(user.role);
    setEditPermissions(resolveUserPermissions(user));
    setEditEmployeeId(user.employeeId || '');
    setEditStation(user.operatorStation || '');
    setEditActive(user.active !== false);
    setEditError(null);
    setEditActiveTab('info');
    setIsEditModalOpen(true);
  };

  // Filtered and Searched Users
  const filteredUsers = useMemo(() => {
    return users.filter((u) => {
      // Role Filter
      if (roleFilter !== 'all' && u.role !== roleFilter) return false;

      // Status Filter
      if (statusFilter === 'active' && !u.active) return false;
      if (statusFilter === 'inactive' && u.active) return false;

      // Search Query
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase().trim();
        const emailMatch = u.email?.toLowerCase().includes(query);
        const nameMatch = u.fullName?.toLowerCase().includes(query);
        const empNameMatch = u.employeeName?.toLowerCase().includes(query);
        const empCodeMatch = u.employeeCode?.toLowerCase().includes(query);
        const usernameMatch = u.username?.toLowerCase().includes(query);
        const stationMatch = u.operatorStation?.toLowerCase().includes(query);

        return emailMatch || nameMatch || empNameMatch || empCodeMatch || usernameMatch || stationMatch;
      }

      return true;
    });
  }, [users, roleFilter, statusFilter, searchQuery]);

  // Statistics
  const totalCount = users.length;
  const activeCount = users.filter((u) => u.active).length;
  const productionUsersCount = users.filter((u) => u.role === 'PRODUCTION_USER' || u.role === 'PRODUCTION_OPERATOR').length;
  const superAdminCount = users.filter((u) => u.role === 'SUPER_ADMIN').length;

  const renderRoleBadge = (role: UserRole) => {
    switch (role) {
      case 'SUPER_ADMIN':
        return <Badge variant="info">SUPER_ADMIN</Badge>;
      case 'PRODUCTION_SUPERVISOR':
      case 'SUPERVISOR':
        return <Badge variant="warning">SUPERVISOR</Badge>;
      case 'PRODUCTION_OPERATOR':
      case 'PRODUCTION_USER':
        return <Badge variant="warning">OPERATOR</Badge>;
      case 'QUALITY_CONTROL':
        return <Badge variant="success">QUALITY CONTROL</Badge>;
      case 'DATA_ENTRY':
        return <Badge variant="neutral">DATA ENTRY</Badge>;
      case 'ACCOUNTING':
        return <Badge variant="neutral">ACCOUNTING</Badge>;
      case 'MAINTENANCE':
        return <Badge variant="warning">MAINTENANCE</Badge>;
      default:
        return <Badge variant="neutral">{role}</Badge>;
    }
  };

  return (
    <div className="space-y-6 select-none" dir={isRtl ? 'rtl' : 'ltr'}>
      {/* Top Header & Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-5 rounded-2xl border border-slate-200 shadow-xs">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600 shrink-0">
              <Users className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-black text-slate-800 tracking-tight">
                {t('nav_user_management')}
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                {language === 'ar' ? 'إدارة حسابات المشغلين وقوالب الصلاحيات الدقيقة المفصلة (Granular Access)' : 'Manage operator accounts, preset templates, and granular access rights'}
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            type="button"
            id="btn-create-user"
            onClick={() => {
              setCreateError(null);
              setCreateActiveTab('info');
              setIsCreateModalOpen(true);
            }}
            className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold text-xs rounded-xl shadow-xs transition-colors flex items-center gap-2 cursor-pointer"
          >
            <UserPlus className="w-4 h-4" />
            <span>{language === 'ar' ? 'إضافة مستخدم جديد +' : 'Create New User +'}</span>
          </button>
        </div>
      </div>

      {/* Action Alerts */}
      {actionSuccessMessage && (
        <div className="p-4 bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs rounded-xl flex items-center justify-between shadow-xs">
          <div className="flex items-center gap-2.5">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span className="font-bold">{actionSuccessMessage}</span>
          </div>
          <button
            type="button"
            onClick={() => setActionSuccessMessage(null)}
            className="text-emerald-600 hover:text-emerald-900 font-bold cursor-pointer"
          >
            &times;
          </button>
        </div>
      )}

      {actionErrorMessage && (
        <div className="p-4 bg-rose-50 border border-rose-200 text-rose-800 text-xs rounded-xl flex items-center justify-between shadow-xs">
          <div className="flex items-center gap-2.5">
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
            <span className="font-bold">{actionErrorMessage}</span>
          </div>
          <button
            type="button"
            onClick={() => setActionErrorMessage(null)}
            className="text-rose-600 hover:text-rose-900 font-bold cursor-pointer"
          >
            &times;
          </button>
        </div>
      )}

      {/* KPI Stats Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Total Users */}
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500">{language === 'ar' ? 'إجمالي المستخدمين' : 'Total Users'}</span>
            <Users className="w-4 h-4 text-indigo-500" />
          </div>
          <div className="text-2xl font-black text-slate-800 mt-2">
            {toWesternDigits(totalCount)}
          </div>
          <p className="text-[11px] text-slate-400 mt-1">{language === 'ar' ? 'حسابات مسجلة بقاعدة البيانات' : 'Registered Firestore Accounts'}</p>
        </div>

        {/* Production Users */}
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-amber-700">{language === 'ar' ? 'مشغلو خطوط الإنتاج' : 'Plant Operators'}</span>
            <Cpu className="w-4 h-4 text-amber-500" />
          </div>
          <div className="text-2xl font-black text-amber-600 mt-2">
            {toWesternDigits(productionUsersCount)}
          </div>
          <p className="text-[11px] text-slate-400 mt-1">{language === 'ar' ? 'شاشات الإنتاج الميدانية' : 'Operator Portal Accounts'}</p>
        </div>

        {/* Super Admins */}
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-indigo-700">{language === 'ar' ? 'المشرفون والإداريون' : 'Super Admins'}</span>
            <ShieldCheck className="w-4 h-4 text-indigo-500" />
          </div>
          <div className="text-2xl font-black text-indigo-600 mt-2">
            {toWesternDigits(superAdminCount)}
          </div>
          <p className="text-[11px] text-slate-400 mt-1">{language === 'ar' ? 'صلاحية كاملة SUPER_ADMIN' : 'Full Root Access'}</p>
        </div>

        {/* Active Accounts */}
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-emerald-700">{language === 'ar' ? 'الحسابات النشطة' : 'Active Accounts'}</span>
            <UserCheck className="w-4 h-4 text-emerald-500" />
          </div>
          <div className="text-2xl font-black text-emerald-600 mt-2">
            {toWesternDigits(activeCount)} / {toWesternDigits(totalCount)}
          </div>
          <p className="text-[11px] text-slate-400 mt-1">
            {totalCount > 0 ? toWesternDigits(Math.round((activeCount / totalCount) * 100)) : 0}% {language === 'ar' ? 'نشط ومصرح' : 'Active & Authorized'}
          </p>
        </div>
      </div>

      {/* Search and Filters Bar */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs flex flex-col md:flex-row items-center justify-between gap-4">
        {/* Search Field */}
        <div className="relative w-full md:w-80">
          <div className={`absolute inset-y-0 ${isRtl ? 'right-0 pr-3' : 'left-0 pl-3'} flex items-center pointer-events-none text-slate-400`}>
            <Search className="w-4 h-4" />
          </div>
          <input
            id="user-search-input"
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t('search')}
            className={`w-full bg-slate-50 border border-slate-200 rounded-lg ${isRtl ? 'pr-9 pl-4' : 'pl-9 pr-4'} py-2 text-xs text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-indigo-500`}
          />
        </div>

        {/* Filters */}
        <div className="flex items-center gap-2.5 w-full md:w-auto flex-wrap">
          <select
            id="role-filter-select"
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
            className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs text-slate-700 font-bold focus:outline-none focus:border-indigo-500 cursor-pointer"
          >
            <option value="all">{language === 'ar' ? 'جميع الأدوار (All Roles)' : 'All Roles'}</option>
            <option value="SUPER_ADMIN">SUPER_ADMIN</option>
            <option value="PRODUCTION_SUPERVISOR">PRODUCTION_SUPERVISOR</option>
            <option value="PRODUCTION_OPERATOR">PRODUCTION_OPERATOR</option>
            <option value="QUALITY_CONTROL">QUALITY_CONTROL</option>
            <option value="DATA_ENTRY">DATA_ENTRY</option>
            <option value="ACCOUNTING">ACCOUNTING</option>
            <option value="REPORT_VIEWER">REPORT_VIEWER</option>
            <option value="MAINTENANCE">MAINTENANCE</option>
          </select>

          <select
            id="status-filter-select"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as any)}
            className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs text-slate-700 font-bold focus:outline-none focus:border-indigo-500 cursor-pointer"
          >
            <option value="all">{language === 'ar' ? 'جميع الحالات' : 'All Status'}</option>
            <option value="active">{language === 'ar' ? 'النشطة فقط' : 'Active Only'}</option>
            <option value="inactive">{language === 'ar' ? 'المعطلة فقط' : 'Inactive Only'}</option>
          </select>
        </div>
      </div>

      {/* Users Table */}
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-xs">
        {isLoading ? (
          <div className="p-12 text-center text-slate-500 text-xs">
            <RefreshCw className="w-6 h-6 animate-spin mx-auto text-indigo-600 mb-2" />
            <span>{t('loading')}</span>
          </div>
        ) : filteredUsers.length === 0 ? (
          <div className="p-12 text-center text-slate-400 text-xs">
            <Users className="w-8 h-8 mx-auto text-slate-300 mb-2" />
            <p className="font-bold text-slate-600">{language === 'ar' ? 'لا يوجد مستخدمون مطابقون لمعايير البحث' : 'No users match your criteria'}</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-start">
              <thead className="bg-slate-50 text-slate-600 font-bold border-b border-slate-200">
                <tr>
                  <th className="p-3.5 text-start">{language === 'ar' ? 'المستخدم / العامل' : 'User / Employee'}</th>
                  <th className="p-3.5 text-start">{language === 'ar' ? 'البريد الإلكتروني' : 'Email'}</th>
                  <th className="p-3.5 text-start">{language === 'ar' ? 'الدور' : 'Role'}</th>
                  <th className="p-3.5 text-start">{language === 'ar' ? 'الصلاحيات الدقيقة' : 'Granular Perms'}</th>
                  <th className="p-3.5 text-start">{language === 'ar' ? 'المحطة / القسم' : 'Station'}</th>
                  <th className="p-3.5 text-start">{language === 'ar' ? 'الحالة' : 'Status'}</th>
                  <th className="p-3.5 text-start">{language === 'ar' ? 'تاريخ الإنشاء' : 'Created'}</th>
                  <th className="p-3.5 text-center">{language === 'ar' ? 'الإجراءات' : 'Actions'}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredUsers.map((user) => {
                  const isPrimaryAdmin = user.email.toLowerCase() === SECURITY_ADMIN_EMAIL.toLowerCase();
                  const userPerms = resolveUserPermissions(user);
                  const activePermCount = countActivePermissions(userPerms);

                  return (
                    <tr key={user.uid} className="hover:bg-slate-50/80 transition-colors">
                      {/* User & Employee Info */}
                      <td className="p-3.5">
                        <div className="flex items-center gap-2.5">
                          <div className={`w-8 h-8 rounded-full ${user.role === 'SUPER_ADMIN' ? 'bg-indigo-600' : 'bg-slate-800'} text-white font-black flex items-center justify-center text-xs shrink-0`}>
                            {user.username?.charAt(0).toUpperCase() || 'U'}
                          </div>
                          <div>
                            <p className="font-bold text-slate-800 leading-tight">
                              {user.fullName || user.username}
                            </p>
                            {user.employeeCode && (
                              <p className="text-[11px] text-slate-500 font-mono">
                                {language === 'ar' ? 'كود العامل' : 'Emp'}: {toWesternDigits(user.employeeCode)}
                              </p>
                            )}
                          </div>
                        </div>
                      </td>

                      {/* Email */}
                      <td className="p-3.5 font-mono text-slate-700">
                        <div className="flex items-center gap-1.5">
                          <Mail className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                          <span className="truncate max-w-[180px]">{user.email}</span>
                        </div>
                      </td>

                      {/* Role Badge */}
                      <td className="p-3.5">
                        {renderRoleBadge(user.role)}
                      </td>

                      {/* Granular Permissions Count */}
                      <td className="p-3.5">
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-100 border border-slate-200 text-slate-700 font-mono text-[11px] font-bold">
                          <ShieldCheck className="w-3 h-3 text-indigo-500" />
                          <span>{activePermCount} / 26</span>
                        </span>
                      </td>

                      {/* Station / Department */}
                      <td className="p-3.5 text-slate-600">
                        {user.operatorStation ? (
                          <span className="flex items-center gap-1 text-[11px]">
                            <MapPin className="w-3 h-3 text-slate-400" />
                            <span>{user.operatorStation}</span>
                          </span>
                        ) : (
                          <span className="text-slate-400 text-[10px]">-</span>
                        )}
                      </td>

                      {/* Status Toggle Badge */}
                      <td className="p-3.5">
                        <button
                          type="button"
                          disabled={isPrimaryAdmin}
                          onClick={() => handleToggleStatus(user)}
                          title={isPrimaryAdmin ? 'حساب المشرف الرئيسي دائم النشاط' : user.active ? 'انقر للتعطيل' : 'انقر للتفعيل'}
                          className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold transition-colors cursor-pointer disabled:cursor-not-allowed ${
                            user.active
                              ? 'bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100'
                              : 'bg-rose-50 text-rose-700 border border-rose-200 hover:bg-rose-100'
                          }`}
                        >
                          {user.active ? (
                            <>
                              <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                              <span>{t('active')}</span>
                            </>
                          ) : (
                            <>
                              <XCircle className="w-3 h-3 text-rose-600" />
                              <span>{t('inactive')}</span>
                            </>
                          )}
                        </button>
                      </td>

                      {/* Created Date */}
                      <td className="p-3.5 text-[11px] font-mono text-slate-500">
                        {user.createdAt ? formatDate(user.createdAt) : '-'}
                      </td>

                      {/* Actions */}
                      <td className="p-3.5 text-center">
                        <div className="flex items-center justify-center gap-1.5">
                          {/* Send Password Reset Email */}
                          <button
                            type="button"
                            onClick={() => setPasswordResetUser(user)}
                            title={language === 'ar' ? 'إرسال رابط إعادة تعيين كلمة المرور' : 'Send Password Reset'}
                            className="p-1.5 text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors cursor-pointer"
                          >
                            <Key className="w-4 h-4" />
                          </button>

                          {/* Edit User & Permissions */}
                          <button
                            type="button"
                            onClick={() => openEditModal(user)}
                            title={language === 'ar' ? 'تعديل الصلاحيات والبيانات' : 'Edit Permissions & User'}
                            className="p-1.5 text-slate-500 hover:text-amber-600 hover:bg-amber-50 rounded-lg transition-colors cursor-pointer"
                          >
                            <Edit3 className="w-4 h-4" />
                          </button>

                          {/* Delete User */}
                          {!isPrimaryAdmin && (
                            <button
                              type="button"
                              onClick={() => setDeleteTargetUser(user)}
                              title={t('delete')}
                              className="p-1.5 text-slate-500 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ========================================================================= */}
      {/* MODAL 1: Create New User with Granular Permissions */}
      {/* ========================================================================= */}
      <Modal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        title={t('create_user_title')}
        subtitle={language === 'ar' ? 'إنشاء حساب مستخدم معتمد وضبط الصلاحيات الدقيقة في Firebase' : 'Create authorized account and set granular permissions'}
        maxWidth="2xl"
      >
        <form onSubmit={handleCreateSubmit} className="space-y-4" dir={isRtl ? 'rtl' : 'ltr'}>
          {createError && (
            <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-xl flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-rose-500 shrink-0" />
              <span>{createError}</span>
            </div>
          )}

          {/* Modal Tab Headers */}
          <div className="flex items-center gap-2 border-b border-slate-200 pb-2">
            <button
              type="button"
              onClick={() => setCreateActiveTab('info')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer flex items-center gap-1.5 ${
                createActiveTab === 'info'
                  ? 'bg-indigo-600 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              <User className="w-3.5 h-3.5" />
              <span>{language === 'ar' ? '1. البيانات الأساسية' : '1. Basic Info'}</span>
            </button>

            <button
              type="button"
              onClick={() => setCreateActiveTab('permissions')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer flex items-center gap-1.5 ${
                createActiveTab === 'permissions'
                  ? 'bg-indigo-600 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>{language === 'ar' ? '2. الصلاحيات الدقيقة (Granular Permissions)' : '2. Granular Permissions'}</span>
            </button>
          </div>

          {/* Tab 1: Info */}
          {createActiveTab === 'info' && (
            <div className="space-y-4">
              {/* Employee Selection */}
              <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-200/80 space-y-2">
                <label className="block text-xs font-bold text-slate-700">
                  {t('link_employee')}
                </label>
                <select
                  id="create-employee-select"
                  value={createEmployeeId}
                  onChange={(e) => handleEmployeeSelection(e.target.value)}
                  className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs text-slate-800 focus:outline-none focus:border-indigo-500 cursor-pointer"
                >
                  <option value="">{language === 'ar' ? '-- بدون ربط بعامل (مستخدم خارجي / مشرف) --' : '-- No employee link --'}</option>
                  {employees.map((emp) => (
                    <option key={emp.id} value={emp.id}>
                      {emp.name} &bull; {language === 'ar' ? 'كود' : 'Code'}: {toWesternDigits(emp.code)} {emp.departmentName ? `(${emp.departmentName})` : ''}
                    </option>
                  ))}
                </select>
              </div>

              {/* Credentials */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    {t('email_username')} *
                  </label>
                  <input
                    id="create-user-email"
                    type="email"
                    required
                    value={createEmail}
                    onChange={(e) => setCreateEmail(e.target.value)}
                    placeholder="operator_101@asfour.local"
                    className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs text-slate-800 focus:outline-none focus:border-indigo-500 font-mono"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    {t('password_label')} *
                  </label>
                  <div className="relative">
                    <input
                      id="create-user-password"
                      type={showCreatePassword ? 'text' : 'password'}
                      required
                      value={createPassword}
                      onChange={(e) => setCreatePassword(e.target.value)}
                      placeholder="لا تقل عن 6 أحرف"
                      className="w-full bg-white border border-slate-200 rounded-lg pr-3 pl-9 py-2 text-xs text-slate-800 focus:outline-none focus:border-indigo-500 font-mono"
                    />
                    <button
                      type="button"
                      onClick={() => setShowCreatePassword(!showCreatePassword)}
                      className="absolute inset-y-0 left-0 pl-2.5 flex items-center text-slate-400 hover:text-slate-600 cursor-pointer"
                    >
                      {showCreatePassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>
              </div>

              {/* Role & Station */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    {language === 'ar' ? 'الدور الأساسي (Base Role)' : 'Base Role Preset'} *
                  </label>
                  <select
                    id="create-user-role"
                    value={createRole}
                    onChange={(e) => handleCreateRoleChange(e.target.value as UserRole)}
                    className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs text-slate-800 focus:outline-none focus:border-indigo-500 cursor-pointer font-bold"
                  >
                    <option value="PRODUCTION_OPERATOR">PRODUCTION_OPERATOR (مشغل خط الإنتاج)</option>
                    <option value="PRODUCTION_SUPERVISOR">PRODUCTION_SUPERVISOR (مشرف إنتاج)</option>
                    <option value="QUALITY_CONTROL">QUALITY_CONTROL (مراقب الجودة)</option>
                    <option value="DATA_ENTRY">DATA_ENTRY (مدخل بيانات)</option>
                    <option value="ACCOUNTING">ACCOUNTING (محاسبة وتكاليف)</option>
                    <option value="REPORT_VIEWER">REPORT_VIEWER (مشاهد تقارير)</option>
                    <option value="MAINTENANCE">MAINTENANCE (مسؤول صيانة)</option>
                    <option value="SUPER_ADMIN">SUPER_ADMIN (مشرف عام كامل الصلاحيات)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    {t('operator_station')}
                  </label>
                  <input
                    id="create-user-station"
                    type="text"
                    value={createStation}
                    onChange={(e) => setCreateStation(e.target.value)}
                    placeholder="مثال: مكبس 1200 طن / خط تشكيل 1"
                    className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs text-slate-800 focus:outline-none focus:border-indigo-500"
                  />
                </div>
              </div>

              {/* Active Toggle */}
              <div className="flex items-center justify-between p-3 bg-slate-50 rounded-xl border border-slate-200">
                <div>
                  <p className="text-xs font-bold text-slate-800">{language === 'ar' ? 'حالة الحساب المبدئية' : 'Account Status'}</p>
                  <p className="text-[11px] text-slate-500">{language === 'ar' ? 'تفعيل الحساب يتيح للمستخدم تسجيل الدخول فوراً' : 'Active accounts can authenticate immediately'}</p>
                </div>
                <input
                  type="checkbox"
                  checked={createActive}
                  onChange={(e) => setCreateActive(e.target.checked)}
                  className="w-5 h-5 rounded text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                />
              </div>
            </div>
          )}

          {/* Tab 2: Granular Permissions Editor */}
          {createActiveTab === 'permissions' && (
            <GranularPermissionEditor
              permissions={createPermissions}
              onChange={setCreatePermissions}
              selectedRolePreset={createRole}
              onRolePresetSelect={(r) => setCreateRole(r)}
            />
          )}

          {/* Modal Footer Buttons */}
          <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-slate-200">
            <button
              type="button"
              onClick={() => setIsCreateModalOpen(false)}
              className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-lg transition-colors cursor-pointer"
            >
              {t('cancel')}
            </button>
            <button
              id="submit-create-user-btn"
              type="submit"
              disabled={isCreating}
              className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-lg transition-colors flex items-center gap-2 cursor-pointer disabled:opacity-50"
            >
              {isCreating ? (
                <>
                  <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                  <span>{language === 'ar' ? 'جارٍ الإنشاء في Firebase...' : 'Creating in Firebase...'}</span>
                </>
              ) : (
                <span>{language === 'ar' ? 'تأكيد إنشاء المستخدم' : 'Confirm Create User'}</span>
              )}
            </button>
          </div>
        </form>
      </Modal>

      {/* ========================================================================= */}
      {/* MODAL 2: Edit User & Granular Permissions */}
      {/* ========================================================================= */}
      <Modal
        isOpen={isEditModalOpen}
        onClose={() => setIsEditModalOpen(false)}
        title={t('edit_user_title')}
        subtitle={`${language === 'ar' ? 'المستخدم' : 'User'}: ${editingUser?.email || ''}`}
        maxWidth="2xl"
      >
        <form onSubmit={handleEditSubmit} className="space-y-4" dir={isRtl ? 'rtl' : 'ltr'}>
          {editError && (
            <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-xl flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-rose-500 shrink-0" />
              <span>{editError}</span>
            </div>
          )}

          {/* Modal Tab Headers */}
          <div className="flex items-center gap-2 border-b border-slate-200 pb-2">
            <button
              type="button"
              onClick={() => setEditActiveTab('info')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer flex items-center gap-1.5 ${
                editActiveTab === 'info'
                  ? 'bg-indigo-600 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              <User className="w-3.5 h-3.5" />
              <span>{language === 'ar' ? '1. البيانات الأساسية والربط' : '1. Basic Info & Link'}</span>
            </button>

            <button
              type="button"
              onClick={() => setEditActiveTab('permissions')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer flex items-center gap-1.5 ${
                editActiveTab === 'permissions'
                  ? 'bg-indigo-600 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>{language === 'ar' ? '2. الصلاحيات الدقيقة (Granular Permissions)' : '2. Granular Permissions'}</span>
            </button>
          </div>

          {/* Tab 1: Info */}
          {editActiveTab === 'info' && (
            <div className="space-y-4">
              {/* Employee Link */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  {t('link_employee')}
                </label>
                <select
                  value={editEmployeeId}
                  onChange={(e) => setEditEmployeeId(e.target.value)}
                  className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs text-slate-800 focus:outline-none focus:border-indigo-500 cursor-pointer"
                >
                  <option value="">{language === 'ar' ? '-- بدون ربط بعامل --' : '-- No employee link --'}</option>
                  {employees.map((emp) => (
                    <option key={emp.id} value={emp.id}>
                      {emp.name} &bull; {language === 'ar' ? 'كود' : 'Code'}: {toWesternDigits(emp.code)}
                    </option>
                  ))}
                </select>
              </div>

              {/* Role */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    {language === 'ar' ? 'الدور الأساسي (Base Role)' : 'Base Role Preset'} *
                  </label>
                  <select
                    value={editRole}
                    onChange={(e) => handleEditRoleChange(e.target.value as UserRole)}
                    className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs text-slate-800 focus:outline-none focus:border-indigo-500 cursor-pointer font-bold"
                  >
                    <option value="PRODUCTION_OPERATOR">PRODUCTION_OPERATOR (مشغل خط الإنتاج)</option>
                    <option value="PRODUCTION_SUPERVISOR">PRODUCTION_SUPERVISOR (مشرف إنتاج)</option>
                    <option value="QUALITY_CONTROL">QUALITY_CONTROL (مراقب الجودة)</option>
                    <option value="DATA_ENTRY">DATA_ENTRY (مدخل بيانات)</option>
                    <option value="ACCOUNTING">ACCOUNTING (محاسبة وتكاليف)</option>
                    <option value="REPORT_VIEWER">REPORT_VIEWER (مشاهد تقارير)</option>
                    <option value="MAINTENANCE">MAINTENANCE (مسؤول صيانة)</option>
                    <option value="SUPER_ADMIN">SUPER_ADMIN (مشرف عام كامل الصلاحيات)</option>
                  </select>
                </div>

                {/* Station */}
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    {t('operator_station')}
                  </label>
                  <input
                    type="text"
                    value={editStation}
                    onChange={(e) => setEditStation(e.target.value)}
                    placeholder="مثال: خط الكبس 1"
                    className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs text-slate-800 focus:outline-none focus:border-indigo-500"
                  />
                </div>
              </div>

              {/* Active Switch */}
              <div className="flex items-center justify-between p-3 bg-slate-50 rounded-xl border border-slate-200">
                <div>
                  <p className="text-xs font-bold text-slate-800">{language === 'ar' ? 'حالة الحساب' : 'Account Status'}</p>
                  <p className="text-[11px] text-slate-500">{language === 'ar' ? 'تمكين أو تعطيل دخول المستخدم' : 'Enable or disable account access'}</p>
                </div>
                <input
                  type="checkbox"
                  checked={editActive}
                  onChange={(e) => setEditActive(e.target.checked)}
                  className="w-5 h-5 rounded text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                />
              </div>
            </div>
          )}

          {/* Tab 2: Granular Permissions Editor */}
          {editActiveTab === 'permissions' && (
            <GranularPermissionEditor
              permissions={editPermissions}
              onChange={setEditPermissions}
              selectedRolePreset={editRole}
              onRolePresetSelect={(r) => setEditRole(r)}
            />
          )}

          {/* Modal Footer */}
          <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-slate-200">
            <button
              type="button"
              onClick={() => setIsEditModalOpen(false)}
              className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-lg transition-colors cursor-pointer"
            >
              {t('cancel')}
            </button>
            <button
              type="submit"
              disabled={isUpdating}
              className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-lg transition-colors flex items-center gap-2 cursor-pointer disabled:opacity-50"
            >
              {isUpdating ? (
                <>
                  <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                  <span>{language === 'ar' ? 'جارٍ الحفظ...' : 'Saving...'}</span>
                </>
              ) : (
                <span>{t('save')}</span>
              )}
            </button>
          </div>
        </form>
      </Modal>

      {/* ========================================================================= */}
      {/* MODAL 3: Password Reset Confirmation */}
      {/* ========================================================================= */}
      <Modal
        isOpen={!!passwordResetUser}
        onClose={() => setPasswordResetUser(null)}
        title={language === 'ar' ? 'إعادة تعيين كلمة المرور' : 'Reset Password'}
        subtitle={language === 'ar' ? 'إرسال رابط آمن عبر Firebase Authentication' : 'Send secure email link'}
        maxWidth="sm"
      >
        <div className="space-y-4 text-xs" dir={isRtl ? 'rtl' : 'ltr'}>
          <p className="text-slate-600 leading-relaxed">
            {language === 'ar'
              ? `هل ترغب في إرسال بريد إلكتروني رسمي من Firebase Authentication إلى المستخدم ${passwordResetUser?.email} لإعادة تعيين كلمة المرور الخاصة به؟`
              : `Send official password reset email to ${passwordResetUser?.email}?`}
          </p>

          <div className="p-3 bg-amber-50 rounded-xl border border-amber-200 text-amber-800 text-[11px]">
            {language === 'ar' ? 'لن يتم تخزين كلمات المرور أو عرضها داخل المتصفح، وسيتلقى المستخدم رابطاً مشفراً.' : 'Passwords are securely managed by Firebase Authentication.'}
          </div>

          <div className="flex items-center justify-end gap-2.5 pt-2">
            <button
              type="button"
              onClick={() => setPasswordResetUser(null)}
              className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-lg cursor-pointer"
            >
              {t('cancel')}
            </button>
            <button
              type="button"
              disabled={isSendingReset}
              onClick={handleSendPasswordReset}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-lg flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              {isSendingReset ? (
                <span>{t('loading')}</span>
              ) : (
                <>
                  <Key className="w-3.5 h-3.5" />
                  <span>{language === 'ar' ? 'إرسال الرابط' : 'Send Link'}</span>
                </>
              )}
            </button>
          </div>
        </div>
      </Modal>

      {/* ========================================================================= */}
      {/* MODAL 4: Delete User Confirmation */}
      {/* ========================================================================= */}
      <Modal
        isOpen={!!deleteTargetUser}
        onClose={() => setDeleteTargetUser(null)}
        title={language === 'ar' ? 'تأكيد حذف صلاحيات المستخدم' : 'Confirm User Deletion'}
        subtitle={language === 'ar' ? 'حذف وثيقة المستخدم من قاعدة البيانات adminUsers' : 'Remove document from adminUsers collection'}
        maxWidth="sm"
      >
        <div className="space-y-4 text-xs" dir={isRtl ? 'rtl' : 'ltr'}>
          <p className="text-slate-600 leading-relaxed">
            {language === 'ar'
              ? `هل أنت متأكد من رغبتك في إزالة صلاحيات المستخدم ${deleteTargetUser?.fullName || deleteTargetUser?.email}؟`
              : `Are you sure you want to delete user ${deleteTargetUser?.fullName || deleteTargetUser?.email}?`}
          </p>
          <p className="text-rose-600 font-bold">
            {language === 'ar' ? 'لن يتمكن هذا المستخدم من تسجيل الدخول للنظام بعد الحذف.' : 'User will not be able to log in after removal.'}
          </p>

          <div className="flex items-center justify-end gap-2.5 pt-2">
            <button
              type="button"
              onClick={() => setDeleteTargetUser(null)}
              className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-lg cursor-pointer"
            >
              {t('cancel')}
            </button>
            <button
              type="button"
              disabled={isDeleting}
              onClick={handleDeleteUser}
              className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold rounded-lg flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              {isDeleting ? (
                <span>{t('loading')}</span>
              ) : (
                <>
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>{t('confirm')}</span>
                </>
              )}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
};

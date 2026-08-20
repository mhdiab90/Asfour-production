/**
 * SUPER_ADMIN User Management Screen
 * Complete interface for creating, managing, linking, activating, and deactivating
 * Firebase Authentication users and PRODUCTION_USER authorization records in Firestore.
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
  User
} from 'lucide-react';
import { 
  AdminUser, 
  Employee, 
  UserRole, 
  CreateUserPayload, 
  UpdateUserPayload, 
  NavigationPage 
} from '../../types';
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

interface UserManagementViewProps {
  onNavigate: (page: NavigationPage) => void;
}

export const UserManagementView: React.FC<UserManagementViewProps> = ({ onNavigate }) => {
  const { adminUser: currentAdminUser } = useAuth();

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
  const [createEmail, setCreateEmail] = useState<string>('');
  const [createPassword, setCreatePassword] = useState<string>('');
  const [showCreatePassword, setShowCreatePassword] = useState<boolean>(false);
  const [createRole, setCreateRole] = useState<UserRole>('PRODUCTION_USER');
  const [createEmployeeId, setCreateEmployeeId] = useState<string>('');
  const [createStation, setCreateStation] = useState<string>('');
  const [createActive, setCreateActive] = useState<boolean>(true);
  const [isCreating, setIsCreating] = useState<boolean>(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Edit User Modal State
  const [isEditModalOpen, setIsEditModalOpen] = useState<boolean>(false);
  const [editingUser, setEditingUser] = useState<AdminUser | null>(null);
  const [editRole, setEditRole] = useState<UserRole>('PRODUCTION_USER');
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
        setActionErrorMessage('تعذر تحميل قائمة المستخدمين من قاعدة البيانات.');
        setIsLoading(false);
      }
    );

    // Load active employees list for linking
    fetchMasterData<Employee>('employees')
      .then((empList) => setEmployees(empList.filter((e) => e.active !== false)))
      .catch((err) => console.warn('Could not load employees list for linking:', err));

    return () => unsubscribe();
  }, []);

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

  // Submit Create User
  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateError(null);

    const email = createEmail.trim();
    const password = createPassword.trim();

    if (!email || !password) {
      setCreateError('يرجى ملء البريد الإلكتروني وكلمة المرور.');
      return;
    }

    if (password.length < 6) {
      setCreateError('كلمة المرور يجب أن لا تقل عن 6 أحرف/أرقام.');
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
    };

    setIsCreating(true);
    try {
      await createSystemUser(payload);
      setActionSuccessMessage(`تم إنشاء حساب المستخدم (${email}) بنجاح وربطه بالصلاحيات المحددة.`);
      setIsCreateModalOpen(false);
      // Reset form
      setCreateEmail('');
      setCreatePassword('');
      setCreateEmployeeId('');
      setCreateStation('');
      setCreateRole('PRODUCTION_USER');
      setCreateActive(true);
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
    };

    setIsUpdating(true);
    try {
      await updateSystemUser(editingUser.uid, payload);
      setActionSuccessMessage(`تم تحديث بيانات المستخدم (${editingUser.email}) بنجاح.`);
      setIsEditModalOpen(false);
      setEditingUser(null);
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
        `تم ${user.active ? 'تعطيل' : 'تفعيل'} حساب المستخدم: ${user.fullName || user.email} بنجاح.`
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
      setActionSuccessMessage(`تم إرسال رابط إعادة تعيين كلمة المرور إلى البريد: ${passwordResetUser.email}`);
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
      setActionSuccessMessage(`تم حذف صلاحيات المستخدم (${deleteTargetUser.email}) بنجاح.`);
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
    setEditEmployeeId(user.employeeId || '');
    setEditStation(user.operatorStation || '');
    setEditActive(user.active !== false);
    setEditError(null);
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
  const productionUsersCount = users.filter((u) => u.role === 'PRODUCTION_USER').length;
  const superAdminCount = users.filter((u) => u.role === 'SUPER_ADMIN').length;

  return (
    <div className="space-y-6" dir="rtl">
      {/* Top Header & Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-5 rounded-2xl border border-slate-200 shadow-xs">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600">
              <Users className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-black text-slate-800 tracking-tight">
                إدارة مستخدمي النظام والصلاحيات
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                إنشاء وإدارة حسابات المشغلين (PRODUCTION_USER) وربطها ببطاقات العمال
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
              setIsCreateModalOpen(true);
            }}
            className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold text-xs rounded-xl shadow-xs transition-colors flex items-center gap-2 cursor-pointer"
          >
            <UserPlus className="w-4 h-4" />
            <span>إضافة مستخدم جديد +</span>
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
            className="text-emerald-600 hover:text-emerald-900 font-bold"
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
            className="text-rose-600 hover:text-rose-900 font-bold"
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
            <span className="text-xs font-bold text-slate-500">إجمالي المستخدمين</span>
            <Users className="w-4 h-4 text-indigo-500" />
          </div>
          <div className="text-2xl font-black text-slate-800 mt-2">
            {toWesternDigits(totalCount)}
          </div>
          <p className="text-[11px] text-slate-400 mt-1">حسابات مسجلة بقاعدة البيانات</p>
        </div>

        {/* Production Users */}
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-amber-700">مشغلو خطوط الإنتاج</span>
            <Cpu className="w-4 h-4 text-amber-500" />
          </div>
          <div className="text-2xl font-black text-amber-600 mt-2">
            {toWesternDigits(productionUsersCount)}
          </div>
          <p className="text-[11px] text-slate-400 mt-1">PRODUCTION_USER (شاشات الإنتاج)</p>
        </div>

        {/* Super Admins */}
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-indigo-700">المشرفون والإداريون</span>
            <ShieldCheck className="w-4 h-4 text-indigo-500" />
          </div>
          <div className="text-2xl font-black text-indigo-600 mt-2">
            {toWesternDigits(superAdminCount)}
          </div>
          <p className="text-[11px] text-slate-400 mt-1">صلاحية إدارة كاملة SUPER_ADMIN</p>
        </div>

        {/* Active Accounts */}
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-emerald-700">الحسابات النشطة</span>
            <UserCheck className="w-4 h-4 text-emerald-500" />
          </div>
          <div className="text-2xl font-black text-emerald-600 mt-2">
            {toWesternDigits(activeCount)} / {toWesternDigits(totalCount)}
          </div>
          <p className="text-[11px] text-slate-400 mt-1">
            {totalCount > 0 ? toWesternDigits(Math.round((activeCount / totalCount) * 100)) : 0}% نشط ومصرح
          </p>
        </div>
      </div>

      {/* Search and Filters Bar */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs flex flex-col md:flex-row items-center justify-between gap-4">
        {/* Search Field */}
        <div className="relative w-full md:w-80">
          <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none text-slate-400">
            <Search className="w-4 h-4" />
          </div>
          <input
            type="text"
            id="user-search-input"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="بحث بالاسم، البريد، كود العامل..."
            className="w-full bg-slate-50 border border-slate-200 rounded-lg pr-9 pl-4 py-2 text-xs text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-indigo-500"
          />
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-3 w-full md:w-auto">
          {/* Role Filter */}
          <div className="flex items-center gap-1.5 text-xs">
            <span className="text-slate-500 font-bold">الدور:</span>
            <select
              id="filter-role-select"
              value={roleFilter}
              onChange={(e) => setRoleFilter(e.target.value)}
              className="bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs text-slate-700 focus:outline-none focus:border-indigo-500 cursor-pointer"
            >
              <option value="all">جميع الأدوار</option>
              <option value="SUPER_ADMIN">SUPER_ADMIN (مدير)</option>
              <option value="PRODUCTION_USER">PRODUCTION_USER (مشغل)</option>
              <option value="SUPERVISOR">SUPERVISOR (مشرف)</option>
              <option value="VIEWER">VIEWER (مشاهد)</option>
            </select>
          </div>

          {/* Status Filter */}
          <div className="flex items-center gap-1.5 text-xs">
            <span className="text-slate-500 font-bold">الحالة:</span>
            <select
              id="filter-status-select"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as any)}
              className="bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs text-slate-700 focus:outline-none focus:border-indigo-500 cursor-pointer"
            >
              <option value="all">جميع الحالات</option>
              <option value="active">نشط فقط (Active)</option>
              <option value="inactive">معطل فقط (Inactive)</option>
            </select>
          </div>
        </div>
      </div>

      {/* Users Data Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
        {isLoading ? (
          <div className="p-12 text-center text-slate-400 text-xs">
            <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin mx-auto mb-3"></div>
            <span>جارٍ تحميل سجلات المستخدمين من قاعدة البيانات...</span>
          </div>
        ) : filteredUsers.length === 0 ? (
          <div className="p-12 text-center text-slate-400 text-xs">
            <Users className="w-10 h-10 text-slate-300 mx-auto mb-2" />
            <p className="font-bold text-slate-600">لا توجد حسابات مستخدمين مطابقة للبحث أو التصفية</p>
            <p className="mt-1">يمكنك إضافة مستخدم جديد بالضغط على زر "إضافة مستخدم جديد +" أعلاه.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-right text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-bold">
                <tr>
                  <th className="p-3.5">المستخدم / العامل المرتبط</th>
                  <th className="p-3.5">البريد الإلكتروني (Firebase Auth)</th>
                  <th className="p-3.5">الدور والصلاحية</th>
                  <th className="p-3.5">المحطة / القسم</th>
                  <th className="p-3.5">الحالة</th>
                  <th className="p-3.5">تاريخ الإنشاء</th>
                  <th className="p-3.5">آخر نشاط</th>
                  <th className="p-3.5 text-center">الإجراءات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredUsers.map((user) => {
                  const isPrimaryAdmin = user.email?.toLowerCase() === SECURITY_ADMIN_EMAIL.toLowerCase();
                  return (
                    <tr key={user.uid} className="hover:bg-slate-50/80 transition-colors">
                      {/* Name & Employee */}
                      <td className="p-3.5">
                        <div className="flex items-center gap-2.5">
                          <div className={`w-8 h-8 rounded-full ${user.role === 'SUPER_ADMIN' ? 'bg-indigo-600 text-white' : 'bg-amber-500 text-slate-950'} font-black text-xs flex items-center justify-center shrink-0`}>
                            {user.fullName ? user.fullName.charAt(0).toUpperCase() : user.username?.charAt(0).toUpperCase() || 'U'}
                          </div>
                          <div>
                            <p className="font-bold text-slate-800 leading-tight">
                              {user.fullName || user.employeeName || user.username}
                            </p>
                            {user.employeeCode ? (
                              <p className="text-[11px] text-indigo-600 font-mono font-bold mt-0.5">
                                كود العامل: {toWesternDigits(user.employeeCode)}
                              </p>
                            ) : (
                              <p className="text-[10px] text-slate-400 mt-0.5">غير مرتبط بعامل</p>
                            )}
                          </div>
                        </div>
                      </td>

                      {/* Email */}
                      <td className="p-3.5 font-mono text-slate-700">
                        <div className="flex items-center gap-1.5">
                          <Mail className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                          <span className="truncate max-w-[200px]">{user.email}</span>
                        </div>
                      </td>

                      {/* Role Badge */}
                      <td className="p-3.5">
                        {user.role === 'SUPER_ADMIN' ? (
                          <Badge variant="info">
                            <ShieldCheck className="w-3 h-3" />
                            <span>SUPER_ADMIN</span>
                          </Badge>
                        ) : user.role === 'PRODUCTION_USER' ? (
                          <Badge variant="warning">
                            <Cpu className="w-3 h-3" />
                            <span>PRODUCTION_USER</span>
                          </Badge>
                        ) : (
                          <Badge variant="neutral">
                            <span>{user.role}</span>
                          </Badge>
                        )}
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
                              <span>نشط</span>
                            </>
                          ) : (
                            <>
                              <XCircle className="w-3 h-3 text-rose-600" />
                              <span>معطل</span>
                            </>
                          )}
                        </button>
                      </td>

                      {/* Created Date */}
                      <td className="p-3.5 text-[11px] font-mono text-slate-500">
                        {user.createdAt ? formatDate(user.createdAt) : '-'}
                      </td>

                      {/* Last Activity */}
                      <td className="p-3.5 text-[11px] font-mono text-slate-500">
                        {user.lastActivity || user.lastLogin ? formatDate(user.lastActivity || user.lastLogin) : 'لم يسجل دخول'}
                      </td>

                      {/* Actions */}
                      <td className="p-3.5">
                        <div className="flex items-center justify-center gap-1.5">
                          {/* Send Password Reset Email */}
                          <button
                            type="button"
                            onClick={() => setPasswordResetUser(user)}
                            title="إرسال رابط إعادة تعيين كلمة المرور"
                            className="p-1.5 text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors cursor-pointer"
                          >
                            <Key className="w-4 h-4" />
                          </button>

                          {/* Edit User */}
                          <button
                            type="button"
                            onClick={() => openEditModal(user)}
                            title="تعديل الصلاحية والبيانات"
                            className="p-1.5 text-slate-500 hover:text-amber-600 hover:bg-amber-50 rounded-lg transition-colors cursor-pointer"
                          >
                            <Edit3 className="w-4 h-4" />
                          </button>

                          {/* Delete User */}
                          {!isPrimaryAdmin && (
                            <button
                              type="button"
                              onClick={() => setDeleteTargetUser(user)}
                              title="حذف المستخدم"
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
      {/* MODAL 1: Create New User */}
      {/* ========================================================================= */}
      <Modal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        title="إنشاء حساب مستخدم جديد (Firebase Auth)"
        subtitle="إنشاء مستخدم معتمد وربطه ببطاقة العامل وحفظ الصلاحيات في adminUsers/{UID}"
        maxWidth="lg"
      >
        <form onSubmit={handleCreateSubmit} className="space-y-4" dir="rtl">
          {createError && (
            <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-xl flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-rose-500 shrink-0" />
              <span>{createError}</span>
            </div>
          )}

          {/* Section 1: Employee Selection */}
          <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-200/80 space-y-2.5">
            <label className="block text-xs font-bold text-slate-700">
              1. اختيار العامل / الموظف من قائمة العمال (Employee Master)
            </label>
            <select
              id="create-employee-select"
              value={createEmployeeId}
              onChange={(e) => handleEmployeeSelection(e.target.value)}
              className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs text-slate-800 focus:outline-none focus:border-indigo-500 cursor-pointer"
            >
              <option value="">-- بدون ربط بعامل (مستخدم خارجي / مشرف) --</option>
              {employees.map((emp) => (
                <option key={emp.id} value={emp.id}>
                  {emp.name} &bull; كود: {toWesternDigits(emp.code)} {emp.departmentName ? `(${emp.departmentName})` : ''}
                </option>
              ))}
            </select>
            <p className="text-[11px] text-slate-500">
              اختيار العامل يتيح للمشغل تسجيل الإنتاج الميداني مباشرة تحت اسمه وهويته الوظيفية.
            </p>
          </div>

          {/* Section 2: Credentials */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
            {/* Email */}
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                البريد الإلكتروني (Email) *
              </label>
              <input
                id="create-user-email"
                type="email"
                required
                value={createEmail}
                onChange={(e) => setCreateEmail(e.target.value)}
                placeholder="operator_101@asfour.local"
                className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs text-slate-800 focus:outline-none focus:border-indigo-500"
              />
            </div>

            {/* Password */}
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                كلمة المرور المبدئية (Password) *
              </label>
              <div className="relative">
                <input
                  id="create-user-password"
                  type={showCreatePassword ? 'text' : 'password'}
                  required
                  value={createPassword}
                  onChange={(e) => setCreatePassword(e.target.value)}
                  placeholder="لا تقل عن 6 أحرف"
                  className="w-full bg-white border border-slate-200 rounded-lg pr-3 pl-9 py-2 text-xs text-slate-800 focus:outline-none focus:border-indigo-500"
                />
                <button
                  type="button"
                  onClick={() => setShowCreatePassword(!showCreatePassword)}
                  className="absolute inset-y-0 left-0 pl-2.5 flex items-center text-slate-400 hover:text-slate-600"
                >
                  {showCreatePassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>
          </div>

          {/* Section 3: Role & Station */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
            {/* Role */}
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                الدور والصلاحية (User Role) *
              </label>
              <select
                id="create-user-role"
                value={createRole}
                onChange={(e) => setCreateRole(e.target.value as UserRole)}
                className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs text-slate-800 focus:outline-none focus:border-indigo-500 cursor-pointer"
              >
                <option value="PRODUCTION_USER">PRODUCTION_USER (مشغل إنتاج - تسجيل مباشر)</option>
                <option value="SUPER_ADMIN">SUPER_ADMIN (مشرف عام - وصول كامل للنظام)</option>
                <option value="SUPERVISOR">SUPERVISOR (مشرف وردية)</option>
                <option value="VIEWER">VIEWER (مشاهد تقارير فقط)</option>
              </select>
            </div>

            {/* Operator Station */}
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                المحطة / المكبس / القسم المخصص
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

          {/* Section 4: Active Toggle */}
          <div className="flex items-center justify-between p-3 bg-slate-50 rounded-xl border border-slate-200">
            <div>
              <p className="text-xs font-bold text-slate-800">حالة الحساب المبدئية</p>
              <p className="text-[11px] text-slate-500">تفعيل الحساب يتيح للمستخدم تسجيل الدخول فوراً</p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={createActive}
                onChange={(e) => setCreateActive(e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-600"></div>
            </label>
          </div>

          {/* Notice */}
          <div className="p-3 bg-indigo-50/60 rounded-xl border border-indigo-100 text-[11px] text-indigo-900 space-y-1">
            <p className="font-bold flex items-center gap-1">
              <ShieldCheck className="w-3.5 h-3.5 text-indigo-600" />
              <span>معايير الأمان وقواعد Firestore السحابية:</span>
            </p>
            <p className="leading-relaxed">
              سيتم إنشاء الحساب في خدمة Firebase Authentication وتخزين ملف الصلاحيات في مجموعة <code>adminUsers/&#123;UID&#125;</code> بدون تخزين كلمة المرور في قاعدة البيانات.
            </p>
          </div>

          {/* Modal Footer Buttons */}
          <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-slate-200">
            <button
              type="button"
              onClick={() => setIsCreateModalOpen(false)}
              className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-lg transition-colors cursor-pointer"
            >
              إلغاء
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
                  <span>جارٍ الإنشاء في Firebase...</span>
                </>
              ) : (
                <span>تأكيد إنشاء المستخدم</span>
              )}
            </button>
          </div>
        </form>
      </Modal>

      {/* ========================================================================= */}
      {/* MODAL 2: Edit User & Employee Link */}
      {/* ========================================================================= */}
      <Modal
        isOpen={isEditModalOpen}
        onClose={() => setIsEditModalOpen(false)}
        title="تعديل بيانات وصلاحيات المستخدم"
        subtitle={`المستخدم: ${editingUser?.email || ''}`}
        maxWidth="md"
      >
        <form onSubmit={handleEditSubmit} className="space-y-4" dir="rtl">
          {editError && (
            <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-xl flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-rose-500 shrink-0" />
              <span>{editError}</span>
            </div>
          )}

          {/* Employee Link */}
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              ربط بالعامل (Employee Link)
            </label>
            <select
              value={editEmployeeId}
              onChange={(e) => setEditEmployeeId(e.target.value)}
              className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs text-slate-800 focus:outline-none focus:border-indigo-500 cursor-pointer"
            >
              <option value="">-- بدون ربط بعامل --</option>
              {employees.map((emp) => (
                <option key={emp.id} value={emp.id}>
                  {emp.name} &bull; كود: {toWesternDigits(emp.code)}
                </option>
              ))}
            </select>
          </div>

          {/* Role */}
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              الدور والصلاحية (User Role) *
            </label>
            <select
              value={editRole}
              onChange={(e) => setEditRole(e.target.value as UserRole)}
              className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs text-slate-800 focus:outline-none focus:border-indigo-500 cursor-pointer"
            >
              <option value="PRODUCTION_USER">PRODUCTION_USER (مشغل إنتاج - شاشات الإنتاج فقط)</option>
              <option value="SUPER_ADMIN">SUPER_ADMIN (مشرف عام - وصول كامل)</option>
              <option value="SUPERVISOR">SUPERVISOR (مشرف)</option>
              <option value="VIEWER">VIEWER (مشاهد)</option>
            </select>
          </div>

          {/* Station */}
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              المحطة / القسم المخصص
            </label>
            <input
              type="text"
              value={editStation}
              onChange={(e) => setEditStation(e.target.value)}
              placeholder="مثال: خط الكبس 1"
              className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs text-slate-800 focus:outline-none focus:border-indigo-500"
            />
          </div>

          {/* Active Switch */}
          <div className="flex items-center justify-between p-3 bg-slate-50 rounded-xl border border-slate-200">
            <div>
              <p className="text-xs font-bold text-slate-800">حالة الحساب</p>
              <p className="text-[11px] text-slate-500">تمكين أو تعطيل دخول المستخدم</p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={editActive}
                onChange={(e) => setEditActive(e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-600"></div>
            </label>
          </div>

          {/* Modal Footer */}
          <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-slate-200">
            <button
              type="button"
              onClick={() => setIsEditModalOpen(false)}
              className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-lg transition-colors cursor-pointer"
            >
              إلغاء
            </button>
            <button
              type="submit"
              disabled={isUpdating}
              className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-lg transition-colors flex items-center gap-2 cursor-pointer disabled:opacity-50"
            >
              {isUpdating ? (
                <>
                  <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                  <span>جارٍ الحفظ...</span>
                </>
              ) : (
                <span>حفظ التعديلات</span>
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
        title="إعادة تعيين كلمة المرور"
        subtitle="إرسال رابط آمن عبر Firebase Authentication"
        maxWidth="sm"
      >
        <div className="space-y-4 text-xs" dir="rtl">
          <p className="text-slate-600 leading-relaxed">
            هل ترغب في إرسال بريد إلكتروني رسمي من Firebase Authentication إلى المستخدم{' '}
            <strong className="text-slate-800 font-mono">{passwordResetUser?.email}</strong> لإعادة تعيين كلمة المرور الخاصة به؟
          </p>

          <div className="p-3 bg-amber-50 rounded-xl border border-amber-200 text-amber-800 text-[11px]">
            لن يتم تخزين كلمات المرور أو عرضها داخل المتصفح، وسيتلقى المستخدم رابطاً مشفراً لتعيين كلمة مروره الجديدة.
          </div>

          <div className="flex items-center justify-end gap-2.5 pt-2">
            <button
              type="button"
              onClick={() => setPasswordResetUser(null)}
              className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-lg cursor-pointer"
            >
              إلغاء
            </button>
            <button
              type="button"
              disabled={isSendingReset}
              onClick={handleSendPasswordReset}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-lg flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              {isSendingReset ? (
                <span>جارٍ الإرسال...</span>
              ) : (
                <>
                  <Key className="w-3.5 h-3.5" />
                  <span>إرسال الرابط</span>
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
        title="تأكيد حذف صلاحيات المستخدم"
        subtitle="حذف وثيقة المستخدم من قاعدة البيانات adminUsers"
        maxWidth="sm"
      >
        <div className="space-y-4 text-xs" dir="rtl">
          <p className="text-slate-600 leading-relaxed">
            هل أنت متأكد من رغبتك في إزالة صلاحيات المستخدم{' '}
            <strong className="text-slate-800">{deleteTargetUser?.fullName || deleteTargetUser?.email}</strong>؟
          </p>
          <p className="text-rose-600 font-bold">
            لن يتمكن هذا المستخدم من تسجيل الدخول للنظام بعد الحذف.
          </p>

          <div className="flex items-center justify-end gap-2.5 pt-2">
            <button
              type="button"
              onClick={() => setDeleteTargetUser(null)}
              className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-lg cursor-pointer"
            >
              إلغاء
            </button>
            <button
              type="button"
              disabled={isDeleting}
              onClick={handleDeleteUser}
              className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold rounded-lg flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              {isDeleting ? (
                <span>جارٍ الحذف...</span>
              ) : (
                <>
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>تأكيد الحذف</span>
                </>
              )}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
};

/**
 * Global Smart Entity Select Component
 * Features:
 * - Search by Code OR Name (Western digits, Arabic normalization)
 * - Autocomplete dropdown with clear visual badges
 * - Inline "+ إضافة جديد" (+ Add New) button for any Master Data entity type
 * - Inline quick creation modal (Employee, Product, Customer, Press, Furnace, Car, Shift, Material, Department, Machine)
 * - Permission-checked: only authorized roles/users see the "+ Add New" button
 * - Automatically saves to Firestore, updates options list, and selects the new item!
 */
import React, { useState, useMemo, useRef, useEffect } from 'react';
import { 
  Search, 
  X, 
  Check, 
  ChevronDown, 
  Plus, 
  User, 
  Box, 
  Flame, 
  Wrench, 
  Clock, 
  Building, 
  Layers, 
  ShieldAlert,
  Save,
  Loader2,
  PackageCheck
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { createMasterDataItem, MASTER_DATA_COLLECTIONS } from '../../services/masterDataService';
import { createMaterial } from '../../services/materialService';
import { matchesSearch } from '../../utils/searchUtils';

export type EntityType = 
  | 'employee' 
  | 'product' 
  | 'customer' 
  | 'press' 
  | 'furnace' 
  | 'car' 
  | 'shift' 
  | 'material' 
  | 'machine' 
  | 'department';

export interface SmartOption {
  id: string;
  code: string;
  name: string;
  subtitle?: string;
  extraBadge?: string;
  category?: string;
  unit?: string;
  rawItem?: any;
}

interface SmartEntitySelectProps {
  id?: string;
  label?: string;
  entityType: EntityType;
  placeholder?: string;
  options: SmartOption[];
  value: string | null | undefined;
  onChange: (selectedId: string | null, option?: SmartOption) => void;
  onItemCreated?: (newOption: SmartOption) => void;
  disabled?: boolean;
  required?: boolean;
  error?: string;
  helperText?: string;
  allowAddNew?: boolean;
}

export const SmartEntitySelect: React.FC<SmartEntitySelectProps> = ({
  id,
  label,
  entityType,
  placeholder = 'ابحث بالكود أو بالاسم...',
  options,
  value,
  onChange,
  onItemCreated,
  disabled = false,
  required = false,
  error,
  helperText,
  allowAddNew = true,
}) => {
  const { adminUser } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [showAddModal, setShowAddModal] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [modalError, setModalError] = useState('');

  // Quick New Entity Form State
  const [newCode, setNewCode] = useState('');
  const [newName, setNewName] = useState('');
  const [newExtra, setNewExtra] = useState('');

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const modalCodeInputRef = useRef<HTMLInputElement>(null);
  const modalNameInputRef = useRef<HTMLInputElement>(null);

  // Check if user has permission to create master data
  const canCreate = useMemo(() => {
    if (!allowAddNew) return false;
    if (!adminUser) return false;
    if (adminUser.role === 'SUPER_ADMIN' || adminUser.role === 'ADMIN') return true;
    const perms = adminUser.permissions as Record<string, any> | undefined;
    return perms?.masterDataCreate === true || perms?.['masterdata.view'] === true || perms?.['products.create'] === true;
  }, [adminUser, allowAddNew]);

  const selectedOption = useMemo(() => {
    if (!value) return null;
    return options.find(opt => opt.id === value) || null;
  }, [value, options]);

  const filteredOptions = useMemo(() => {
    if (!searchQuery.trim()) return options;
    return options.filter(
      opt =>
        matchesSearch(opt.code, searchQuery) ||
        matchesSearch(opt.name, searchQuery) ||
        (opt.subtitle && matchesSearch(opt.subtitle, searchQuery)) ||
        (opt.extraBadge && matchesSearch(opt.extraBadge, searchQuery))
    );
  }, [options, searchQuery]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Autofocus modal input when opened
  useEffect(() => {
    if (showAddModal) {
      const timer = setTimeout(() => {
        if (newCode) {
          modalNameInputRef.current?.focus();
        } else {
          modalCodeInputRef.current?.focus();
        }
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [showAddModal, newCode]);

  const handleSelect = (option: SmartOption) => {
    onChange(option.id, option);
    setSearchQuery('');
    setIsOpen(false);
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange(null);
    setSearchQuery('');
  };

  const getEntityTitleAr = (type: EntityType) => {
    switch (type) {
      case 'employee': return 'موظف / عامل';
      case 'product': return 'منتج حراري';
      case 'customer': return 'عميل';
      case 'press': return 'مكبس';
      case 'furnace': return 'فرن';
      case 'car': return 'عربة فرن';
      case 'shift': return 'وردية';
      case 'material': return 'مادة خام';
      case 'machine': return 'ماكينة';
      case 'department': return 'قسم';
      default: return 'عنصر';
    }
  };

  const renderIcon = (type: EntityType) => {
    switch (type) {
      case 'employee': return <User className="w-4 h-4 text-emerald-600 shrink-0" />;
      case 'product': return <Box className="w-4 h-4 text-amber-600 shrink-0" />;
      case 'press': return <Wrench className="w-4 h-4 text-sky-600 shrink-0" />;
      case 'furnace': return <Flame className="w-4 h-4 text-red-600 shrink-0" />;
      case 'car': return <Layers className="w-4 h-4 text-orange-600 shrink-0" />;
      case 'customer': return <Building className="w-4 h-4 text-indigo-600 shrink-0" />;
      case 'shift': return <Clock className="w-4 h-4 text-teal-600 shrink-0" />;
      case 'material': return <PackageCheck className="w-4 h-4 text-purple-600 shrink-0" />;
      default: return <Box className="w-4 h-4 text-slate-500 shrink-0" />;
    }
  };

  const handleOpenAddModal = (e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    const query = searchQuery.trim();
    const isCodeLike = /^[0-9A-Za-z_.-]+$/.test(query);
    setNewCode(isCodeLike ? query : '');
    setNewName(!isCodeLike ? query : '');
    setNewExtra('');
    setModalError('');
    setShowAddModal(true);
    setIsOpen(false);
  };

  const handleCloseModal = () => {
    setShowAddModal(false);
    setModalError('');
    setTimeout(() => {
      inputRef.current?.focus();
    }, 50);
  };

  const executeSaveQuickEntity = async () => {
    const code = newCode.trim();
    const name = newName.trim();

    if (!code || !name) {
      setModalError('يرجى ملء كود واسم العنصر بدقة.');
      return;
    }

    // Pre-flight duplicate check
    const codeExists = options.some(opt => opt.code && opt.code.trim().toLowerCase() === code.toLowerCase());
    const nameExists = options.some(opt => opt.name && opt.name.trim().toLowerCase() === name.toLowerCase());

    if (codeExists || nameExists) {
      setModalError(
        codeExists 
          ? `هذا البيان موجود بالفعل: الكود "${code}" مسجل مسبقاً. / This record already exists.`
          : `هذا البيان موجود بالفعل: الاسم "${name}" مسجل مسبقاً. / This record already exists.`
      );
      return;
    }

    setIsSaving(true);
    setModalError('');
    try {
      let createdId: string | undefined;

      if (entityType === 'material') {
        createdId = await createMaterial({
          code,
          name,
          unit: newExtra.trim() || 'طن',
          category: 'عام',
          active: true
        });
      } else {
        const collectionName = MASTER_DATA_COLLECTIONS[entityType === 'car' ? 'furnaceCars' : `${entityType}s` as any] || `${entityType}s`;
        createdId = await createMasterDataItem(collectionName, {
          code,
          name,
          active: true,
          ...(entityType === 'product' ? { pieceWeight: Number(newExtra) || 4.5, aluminaPercentage: 40 } : {}),
          ...(entityType === 'employee' ? { department: newExtra.trim() || 'الإنتاج' } : {}),
        });
      }

      const newOption: SmartOption = {
        id: createdId || `new-${Date.now()}`,
        code,
        name,
        subtitle: newExtra || undefined,
      };

      if (onItemCreated) {
        onItemCreated(newOption);
      }

      onChange(newOption.id, newOption);
      setShowAddModal(false);
      setSearchQuery('');
      setTimeout(() => {
        inputRef.current?.focus();
      }, 50);
    } catch (err: any) {
      setModalError(err.message || 'حدث خطأ أثناء حفظ العنصر الجديد.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleModalKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      if (!isSaving) {
        executeSaveQuickEntity();
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      handleCloseModal();
    }
  };

  const handleCreateQuickEntity = async (e: React.FormEvent) => {
    e.preventDefault();
    e.stopPropagation();
    await executeSaveQuickEntity();
  };

  return (
    <div id={id ? `${id}-container` : undefined} ref={containerRef} className="relative w-full" dir="rtl">
      {label && (
        <label id={id ? `${id}-label` : undefined} className="block text-xs font-bold text-slate-700 mb-1.5 uppercase tracking-wide">
          {label} {required && <span className="text-red-500">*</span>}
        </label>
      )}

      {/* Select Box Trigger */}
      <div
        id={id ? `${id}-trigger` : undefined}
        onClick={() => {
          if (!disabled) {
            setIsOpen(true);
            setTimeout(() => inputRef.current?.focus(), 50);
          }
        }}
        className={`relative flex items-center justify-between w-full min-h-[46px] px-3.5 py-2 bg-white border rounded-xl shadow-xs cursor-pointer transition-all duration-150 ${
          disabled
            ? 'bg-slate-100 border-slate-200 cursor-not-allowed opacity-75'
            : isOpen
            ? 'border-red-500 ring-2 ring-red-500/20 bg-white'
            : error
            ? 'border-red-400 bg-red-50/20'
            : 'border-slate-300 hover:border-slate-400'
        }`}
      >
        <div className="flex items-center gap-2 flex-1 min-w-0">
          {renderIcon(entityType)}

          {isOpen ? (
            <input
              ref={inputRef}
              id={id ? `${id}-input` : undefined}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={selectedOption ? `${selectedOption.code} — ${selectedOption.name}` : placeholder}
              className="w-full bg-transparent border-none outline-none text-sm text-slate-800 placeholder-slate-400 focus:ring-0 p-0"
              onClick={(e) => e.stopPropagation()}
            />
          ) : selectedOption ? (
            <div className="flex items-center gap-2 truncate">
              <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-mono font-bold bg-slate-100 text-slate-800 border border-slate-200">
                {selectedOption.code}
              </span>
              <span className="text-sm font-semibold text-slate-900 truncate">
                {selectedOption.name}
              </span>
              {selectedOption.extraBadge && (
                <span className="hidden sm:inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-medium bg-amber-50 text-amber-800 border border-amber-200">
                  {selectedOption.extraBadge}
                </span>
              )}
            </div>
          ) : (
            <span className="text-sm text-slate-400 select-none">
              {placeholder}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5 ms-2 shrink-0">
          {selectedOption && !disabled && (
            <button
              type="button"
              onClick={handleClear}
              className="p-1 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors cursor-pointer"
              title="إلغاء الاختيار"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
          <ChevronDown
            className={`w-4 h-4 text-slate-400 transition-transform duration-200 ${
              isOpen ? 'transform rotate-180 text-red-500' : ''
            }`}
          />
        </div>
      </div>

      {/* Floating Options Dropdown */}
      {isOpen && !disabled && (
        <div
          id={id ? `${id}-dropdown` : undefined}
          className="absolute z-50 w-full mt-1.5 bg-white border border-slate-200 rounded-xl shadow-2xl max-h-72 overflow-y-auto divide-y divide-slate-100 animate-in fade-in zoom-in-95 duration-100"
        >
          {/* Header Info */}
          <div className="px-3 py-2 bg-slate-50 text-[11px] font-medium text-slate-500 flex items-center justify-between">
            <span className="flex items-center gap-1">
              <Search className="w-3 h-3 text-slate-400" />
              البحث بالكود أو الاسم ({filteredOptions.length} عنصر)
            </span>
            {canCreate && (
              <button
                type="button"
                onClick={handleOpenAddModal}
                className="text-red-600 hover:text-red-700 font-bold flex items-center gap-1 hover:underline cursor-pointer"
              >
                <Plus className="w-3 h-3" />
                إضافة {getEntityTitleAr(entityType)}
              </button>
            )}
          </div>

          {filteredOptions.length === 0 ? (
            <div className="p-4 text-center">
              <p className="text-xs text-slate-500 mb-2">
                لا توجد بيانات مطابقة لـ <span className="font-semibold text-slate-800">"{searchQuery}"</span>
              </p>
              {canCreate ? (
                <button
                  type="button"
                  id={id ? `${id}-btn-add-inline` : undefined}
                  onClick={handleOpenAddModal}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white text-xs font-bold rounded-lg shadow-sm transition-all cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  + إضافة {getEntityTitleAr(entityType)} جديد
                </button>
              ) : (
                <p className="text-[11px] text-slate-400">
                  يرجى مراجعة مسؤول النظام لإضافة عناصر جديدة.
                </p>
              )}
            </div>
          ) : (
            <>
              {filteredOptions.map((opt, index) => {
                const isSelected = selectedOption?.id === opt.id;
                return (
                  <div
                    key={opt.id}
                    onClick={() => handleSelect(opt)}
                    className={`flex items-center justify-between px-3.5 py-2.5 cursor-pointer transition-colors ${
                      isSelected
                        ? 'bg-red-50 text-red-900'
                        : 'hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0 flex-1">
                      {renderIcon(entityType)}
                      <div className="flex flex-col min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-mono font-bold bg-slate-100 text-slate-800 border border-slate-200">
                            {opt.code}
                          </span>
                          <span className="text-sm font-semibold text-slate-900 truncate">
                            {opt.name}
                          </span>
                        </div>
                        {opt.subtitle && (
                          <span className="text-xs text-slate-500 truncate mt-0.5">
                            {opt.subtitle}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 ms-3 shrink-0">
                      {opt.extraBadge && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200">
                          {opt.extraBadge}
                        </span>
                      )}
                      {isSelected && <Check className="w-4 h-4 text-red-600 shrink-0" />}
                    </div>
                  </div>
                );
              })}

              {/* Bottom Add Action in Dropdown */}
              {canCreate && (
                <div
                  onClick={handleOpenAddModal}
                  className="px-3.5 py-2.5 bg-red-50/50 hover:bg-red-50 text-red-700 text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer transition-colors border-t border-slate-100"
                >
                  <Plus className="w-4 h-4" />
                  + إضافة {getEntityTitleAr(entityType)} جديد إلى النظام
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Inline Quick Creation Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-md p-6 overflow-hidden">
            <div className="flex items-center justify-between pb-3 mb-4 border-b border-slate-100">
              <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <Plus className="w-5 h-5 text-red-600" />
                إضافة {getEntityTitleAr(entityType)} جديد
              </h3>
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {modalError && (
              <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 text-xs rounded-xl flex items-center gap-2">
                <ShieldAlert className="w-4 h-4 shrink-0" />
                <span>{modalError}</span>
              </div>
            )}

            <form onSubmit={handleCreateQuickEntity} onKeyDown={handleModalKeyDown} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  كود {getEntityTitleAr(entityType)} <span className="text-red-500">*</span>
                </label>
                <input
                  ref={modalCodeInputRef}
                  type="text"
                  required
                  value={newCode}
                  onChange={(e) => setNewCode(e.target.value)}
                  placeholder="مثال: 10025 أو MAT-01 أو P-40"
                  className="w-full px-3.5 py-2.5 text-sm bg-slate-50 border border-slate-300 rounded-xl focus:ring-2 focus:ring-red-500/20 focus:border-red-500 outline-none font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  اسم {getEntityTitleAr(entityType)} <span className="text-red-500">*</span>
                </label>
                <input
                  ref={modalNameInputRef}
                  type="text"
                  required
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder={`اسم ${getEntityTitleAr(entityType)}...`}
                  className="w-full px-3.5 py-2.5 text-sm bg-slate-50 border border-slate-300 rounded-xl focus:ring-2 focus:ring-red-500/20 focus:border-red-500 outline-none"
                />
              </div>

              {entityType === 'product' && (
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    وزن القطعة التقديري (كجم)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={newExtra}
                    onChange={(e) => setNewExtra(e.target.value)}
                    placeholder="4.5"
                    className="w-full px-3.5 py-2.5 text-sm bg-slate-50 border border-slate-300 rounded-xl focus:ring-2 focus:ring-red-500/20 focus:border-red-500 outline-none"
                  />
                </div>
              )}

              {entityType === 'material' && (
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    وحدة القياس
                  </label>
                  <input
                    type="text"
                    value={newExtra}
                    onChange={(e) => setNewExtra(e.target.value)}
                    placeholder="طن / كجم / شيكارة"
                    className="w-full px-3.5 py-2.5 text-sm bg-slate-50 border border-slate-300 rounded-xl focus:ring-2 focus:ring-red-500/20 focus:border-red-500 outline-none"
                  />
                </div>
              )}

              {entityType === 'employee' && (
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    القسم / الوردية
                  </label>
                  <input
                    type="text"
                    value={newExtra}
                    onChange={(e) => setNewExtra(e.target.value)}
                    placeholder="الإنتاج / المكابس"
                    className="w-full px-3.5 py-2.5 text-sm bg-slate-50 border border-slate-300 rounded-xl focus:ring-2 focus:ring-red-500/20 focus:border-red-500 outline-none"
                  />
                </div>
              )}

              <div className="flex items-center justify-between pt-3 border-t border-slate-100">
                <span className="text-[11px] text-slate-400">
                  اضغط <kbd className="px-1.5 py-0.5 bg-slate-100 border border-slate-300 rounded text-slate-700 font-mono text-[10px]">Enter</kbd> للحفظ، <kbd className="px-1.5 py-0.5 bg-slate-100 border border-slate-300 rounded text-slate-700 font-mono text-[10px]">Esc</kbd> للإلغاء
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleCloseModal}
                    className="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-xl transition-colors cursor-pointer"
                  >
                    إلغاء
                  </button>
                  <button
                    type="button"
                    onClick={executeSaveQuickEntity}
                    disabled={isSaving}
                    className="flex items-center gap-1.5 px-5 py-2.5 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-xs font-bold rounded-xl shadow-md transition-all cursor-pointer"
                  >
                    {isSaving ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        جاري الحفظ...
                      </>
                    ) : (
                      <>
                        <Save className="w-4 h-4" />
                        حفظ واختيار (Enter)
                      </>
                    )}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {error ? (
        <p id={id ? `${id}-error` : undefined} className="mt-1.5 text-xs text-red-600 font-medium">
          {error}
        </p>
      ) : helperText ? (
        <p id={id ? `${id}-helper` : undefined} className="mt-1.5 text-xs text-slate-500">
          {helperText}
        </p>
      ) : null}
    </div>
  );
};

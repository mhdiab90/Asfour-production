/**
 * Multi-select sibling of SmartEntitySelect (Part 3 §4/§2/§3) - search-and-
 * pick Master Data with each selection appearing as an independent
 * removable chip, plus the SAME inline "Add New" affordance
 * (permission-checked, reuses `createMasterDataItem`/`createMaterial`).
 *
 * Built to fix a real, confirmed bug: the Rotary Furnace and Mortar &
 * Concrete entry forms' "add worker" buttons always appended
 * `employees[0]` regardless of what the user searched for, because no
 * multi-select Master Data component existed for them to use - Pressing's
 * own multi-select (`MultiSearchableCombobox`) is part of a different,
 * pressing-specific combobox family. This component gives every other
 * stage a real, working equivalent without copying Pressing-specific code.
 */
import React, { useState, useMemo, useRef, useEffect } from 'react';
import { Search, X, Plus, ChevronDown, Loader2, Save } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { createMasterDataItem, MASTER_DATA_COLLECTIONS } from '../../services/masterDataService';
import { createMaterial } from '../../services/materialService';
import { matchesSearch } from '../../utils/searchUtils';
import { EntityType, SmartOption } from './SmartEntitySelect';

interface MultiSmartEntitySelectProps {
  id?: string;
  label?: string;
  entityType: EntityType;
  placeholder?: string;
  options: SmartOption[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  onItemCreated?: (newOption: SmartOption) => void;
  helperText?: string;
  allowAddNew?: boolean;
  language: 'ar' | 'en';
}

export const MultiSmartEntitySelect: React.FC<MultiSmartEntitySelectProps> = ({
  id, label, entityType, placeholder, options, selectedIds, onChange, onItemCreated, helperText, allowAddNew = true, language,
}) => {
  const { adminUser } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [modalError, setModalError] = useState('');
  const [newCode, setNewCode] = useState('');
  const [newName, setNewName] = useState('');

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const t = {
    searchPlaceholder: placeholder || (language === 'ar' ? 'ابحث بالكود أو الاسم...' : 'Search by code or name...'),
    noResults: language === 'ar' ? 'لا توجد نتائج مطابقة' : 'No matching results',
    addNew: language === 'ar' ? 'إضافة جديد' : 'Add New',
    code: language === 'ar' ? 'الكود' : 'Code',
    name: language === 'ar' ? 'الاسم' : 'Name',
    save: language === 'ar' ? 'حفظ' : 'Save',
    cancel: language === 'ar' ? 'إلغاء' : 'Cancel',
    fillBoth: language === 'ar' ? 'يرجى ملء الكود والاسم.' : 'Please fill in both code and name.',
    alreadyExists: language === 'ar' ? 'هذا العنصر موجود بالفعل.' : 'This item already exists.',
    saveError: language === 'ar' ? 'حدث خطأ أثناء الحفظ.' : 'An error occurred while saving.',
  };

  const canCreate = useMemo(() => {
    if (!allowAddNew || !adminUser) return false;
    if (adminUser.role === 'SUPER_ADMIN' || adminUser.role === 'ADMIN') return true;
    const perms = adminUser.permissions as Record<string, any> | undefined;
    return perms?.masterDataCreate === true || perms?.['masterdata.view'] === true;
  }, [adminUser, allowAddNew]);

  const selectedOptions = useMemo(() => selectedIds.map((id2) => options.find((o) => o.id === id2)).filter((o): o is SmartOption => !!o), [selectedIds, options]);

  const filteredOptions = useMemo(() => {
    const notSelected = options.filter((o) => !selectedIds.includes(o.id));
    if (!searchQuery.trim()) return notSelected;
    return notSelected.filter((opt) => matchesSearch(opt.code, searchQuery) || matchesSearch(opt.name, searchQuery));
  }, [options, selectedIds, searchQuery]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setIsOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSelect = (opt: SmartOption) => {
    onChange([...selectedIds, opt.id]);
    setSearchQuery('');
    inputRef.current?.focus();
  };

  const handleRemove = (idToRemove: string) => onChange(selectedIds.filter((i) => i !== idToRemove));

  const handleOpenAddModal = () => {
    const q = searchQuery.trim();
    const isCodeLike = /^[0-9A-Za-z_.-]+$/.test(q);
    setNewCode(isCodeLike ? q : '');
    setNewName(!isCodeLike ? q : '');
    setModalError('');
    setShowAddModal(true);
    setIsOpen(false);
  };

  const executeSave = async () => {
    const code = newCode.trim();
    const name = newName.trim();
    if (!code || !name) { setModalError(t.fillBoth); return; }
    if (options.some((o) => o.code.toLowerCase() === code.toLowerCase() || o.name.toLowerCase() === name.toLowerCase())) {
      setModalError(t.alreadyExists);
      return;
    }
    setIsSaving(true);
    setModalError('');
    try {
      let createdId: string | undefined;
      if (entityType === 'material') {
        createdId = await createMaterial({ code, name, unit: 'طن', category: language === 'ar' ? 'عام' : 'General', active: true });
      } else {
        const collectionName = MASTER_DATA_COLLECTIONS[entityType === 'car' ? 'furnaceCars' : `${entityType}s` as any] || `${entityType}s`;
        createdId = await createMasterDataItem(collectionName, { code, name, active: true });
      }
      const newOption: SmartOption = { id: createdId || `new-${Date.now()}`, code, name };
      if (onItemCreated) onItemCreated(newOption);
      onChange([...selectedIds, newOption.id]);
      setShowAddModal(false);
      setSearchQuery('');
    } catch (err: any) {
      setModalError(err.message || t.saveError);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div ref={containerRef} className="relative w-full" dir={language === 'ar' ? 'rtl' : 'ltr'}>
      {label && <label className="block text-xs font-bold text-slate-700 mb-1.5 uppercase tracking-wide">{label}</label>}

      {selectedOptions.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-1.5">
          {selectedOptions.map((opt) => (
            <span key={opt.id} className="inline-flex items-center gap-1.5 bg-indigo-50 border border-indigo-200 text-indigo-800 rounded-lg px-2.5 py-1 text-xs font-bold">
              <span className="font-mono text-[10px] bg-white px-1 rounded">{opt.code}</span>
              {opt.name}
              <button type="button" onClick={() => handleRemove(opt.id)} className="hover:text-rose-600 cursor-pointer"><X className="w-3 h-3" /></button>
            </span>
          ))}
        </div>
      )}

      <div
        onClick={() => { setIsOpen(true); setTimeout(() => inputRef.current?.focus(), 50); }}
        className={`relative flex items-center justify-between w-full min-h-[42px] px-3 py-2 bg-white border rounded-xl shadow-xs cursor-text transition-all ${isOpen ? 'border-indigo-500 ring-2 ring-indigo-500/20' : 'border-slate-300 hover:border-slate-400'}`}
      >
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <Search className="w-4 h-4 text-slate-400 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onFocus={() => setIsOpen(true)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                if (filteredOptions[0]) handleSelect(filteredOptions[0]);
                else if (searchQuery.trim() && canCreate) handleOpenAddModal();
              }
            }}
            placeholder={t.searchPlaceholder}
            className="w-full bg-transparent border-none outline-none text-sm text-slate-800 placeholder-slate-400 focus:ring-0 p-0"
          />
        </div>
        <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${isOpen ? 'rotate-180 text-indigo-500' : ''}`} />
      </div>

      {isOpen && (
        <div className="absolute z-50 w-full mt-1.5 bg-white border border-slate-200 rounded-xl shadow-2xl max-h-64 overflow-y-auto divide-y divide-slate-100">
          {filteredOptions.length === 0 ? (
            <div className="p-4 text-center">
              <p className="text-xs text-slate-500 mb-2">{t.noResults}</p>
              {canCreate && (
                <button type="button" onClick={handleOpenAddModal} className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-lg cursor-pointer">
                  <Plus className="w-3.5 h-3.5" />{t.addNew}
                </button>
              )}
            </div>
          ) : (
            <>
              {filteredOptions.map((opt) => (
                <div key={opt.id} onClick={() => handleSelect(opt)} className="flex items-center gap-2.5 px-3.5 py-2.5 cursor-pointer hover:bg-slate-50">
                  <span className="font-mono text-xs font-bold bg-slate-100 text-slate-800 border border-slate-200 rounded px-2 py-0.5">{opt.code}</span>
                  <span className="text-sm font-semibold text-slate-900 truncate">{opt.name}</span>
                </div>
              ))}
              {canCreate && (
                <div onClick={handleOpenAddModal} className="px-3.5 py-2.5 bg-indigo-50/50 hover:bg-indigo-50 text-indigo-700 text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer border-t border-slate-100">
                  <Plus className="w-4 h-4" />{t.addNew}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs" dir={language === 'ar' ? 'rtl' : 'ltr'}>
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-md p-6">
            <div className="flex items-center justify-between pb-3 mb-4 border-b border-slate-100">
              <h3 className="text-base font-bold text-slate-900 flex items-center gap-2"><Plus className="w-5 h-5 text-indigo-600" />{t.addNew}</h3>
              <button type="button" onClick={() => setShowAddModal(false)} className="text-slate-400 hover:text-slate-600 p-1 rounded-lg cursor-pointer"><X className="w-5 h-5" /></button>
            </div>
            {modalError && <div className="mb-4 p-3 bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-xl">{modalError}</div>}
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">{t.code}</label>
                <input type="text" value={newCode} onChange={(e) => setNewCode(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') executeSave(); }} className="w-full px-3.5 py-2.5 text-sm bg-slate-50 border border-slate-300 rounded-xl font-mono" autoFocus />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">{t.name}</label>
                <input type="text" value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') executeSave(); }} className="w-full px-3.5 py-2.5 text-sm bg-slate-50 border border-slate-300 rounded-xl" />
              </div>
              <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
                <button type="button" onClick={() => setShowAddModal(false)} className="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-xl cursor-pointer">{t.cancel}</button>
                <button type="button" onClick={executeSave} disabled={isSaving} className="flex items-center gap-1.5 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-xs font-bold rounded-xl cursor-pointer">
                  {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}{t.save}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {helperText && <p className="mt-1.5 text-xs text-slate-500">{helperText}</p>}
    </div>
  );
};

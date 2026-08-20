/**
 * Smart Searchable Combobox Component
 * 
 * Supports instant search across both Code and Name with Arabic/English normalization.
 * Displays both identifier and human-readable name clearly.
 * Supports single-select and multi-select modes with keyboard accessibility.
 */
import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Search, X, Check, ChevronDown, User, Box, Flame, Wrench, Clock, Building, Layers } from 'lucide-react';
import { matchesSearch } from '../../utils/searchUtils';

export interface ComboboxOption {
  id: string;
  code: string;
  name: string;
  subtitle?: string;
  extraBadge?: string;
  iconType?: 'employee' | 'product' | 'press' | 'furnace' | 'car' | 'customer' | 'shift' | 'generic';
  rawItem?: any;
}

interface SearchableComboboxProps {
  id?: string;
  label?: string;
  placeholder?: string;
  options: ComboboxOption[];
  value: string | null | undefined;
  onChange: (selectedId: string | null, option?: ComboboxOption) => void;
  disabled?: boolean;
  required?: boolean;
  error?: string;
  helperText?: string;
  icon?: React.ReactNode;
}

export const SearchableCombobox: React.FC<SearchableComboboxProps> = ({
  id,
  label,
  placeholder = 'ابحث بالكود أو بالاسم...',
  options,
  value,
  onChange,
  disabled = false,
  required = false,
  error,
  helperText,
  icon,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Find currently selected option
  const selectedOption = useMemo(() => {
    if (!value) return null;
    return options.find((opt) => opt.id === value) || null;
  }, [value, options]);

  // In-memory filtered options based on query (searching code OR name)
  const filteredOptions = useMemo(() => {
    if (!searchQuery.trim()) return options;
    return options.filter(
      (opt) =>
        matchesSearch(opt.code, searchQuery) ||
        matchesSearch(opt.name, searchQuery) ||
        (opt.subtitle && matchesSearch(opt.subtitle, searchQuery)) ||
        (opt.extraBadge && matchesSearch(opt.extraBadge, searchQuery))
    );
  }, [options, searchQuery]);

  // Click outside listener
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Reset highlight on query change
  useEffect(() => {
    setHighlightedIndex(0);
  }, [searchQuery]);

  const handleSelect = (option: ComboboxOption) => {
    onChange(option.id, option);
    setSearchQuery('');
    setIsOpen(false);
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange(null);
    setSearchQuery('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return;

    if (!isOpen && (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      setIsOpen(true);
      return;
    }

    if (isOpen) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setHighlightedIndex((prev) => (prev < filteredOptions.length - 1 ? prev + 1 : 0));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setHighlightedIndex((prev) => (prev > 0 ? prev - 1 : filteredOptions.length - 1));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (filteredOptions[highlightedIndex]) {
          handleSelect(filteredOptions[highlightedIndex]);
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        setIsOpen(false);
      }
    }
  };

  const renderIcon = (type?: string) => {
    switch (type) {
      case 'employee':
        return <User className="w-4 h-4 text-emerald-600" />;
      case 'product':
        return <Box className="w-4 h-4 text-amber-600" />;
      case 'press':
        return <Wrench className="w-4 h-4 text-sky-600" />;
      case 'furnace':
        return <Flame className="w-4 h-4 text-red-600" />;
      case 'car':
        return <Layers className="w-4 h-4 text-orange-600" />;
      case 'customer':
        return <Building className="w-4 h-4 text-indigo-600" />;
      case 'shift':
        return <Clock className="w-4 h-4 text-teal-600" />;
      default:
        return icon || <Box className="w-4 h-4 text-slate-500" />;
    }
  };

  return (
    <div id={id ? `${id}-container` : undefined} ref={containerRef} className="relative w-full">
      {label && (
        <label
          id={id ? `${id}-label` : undefined}
          className="block text-xs font-bold text-slate-700 mb-1.5 uppercase tracking-wide"
        >
          {label} {required && <span className="text-red-500">*</span>}
        </label>
      )}

      {/* Combobox Trigger / Search Input */}
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
        tabIndex={disabled ? -1 : 0}
        onKeyDown={handleKeyDown}
      >
        {/* Selected Display or Search Field */}
        <div className="flex items-center gap-2 flex-1 min-w-0">
          {renderIcon(selectedOption?.iconType)}

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
                <span className="hidden sm:inline-flex items-center px-1.5 py-0.2 rounded text-[11px] font-medium bg-amber-50 text-amber-800 border border-amber-200">
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

        {/* Action icons (Clear & Chevron) */}
        <div className="flex items-center gap-1.5 ms-2 shrink-0">
          {selectedOption && !disabled && (
            <button
              id={id ? `${id}-clear-btn` : undefined}
              type="button"
              onClick={handleClear}
              className="p-1 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
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

      {/* Floating Dropdown List */}
      {isOpen && !disabled && (
        <div
          id={id ? `${id}-dropdown` : undefined}
          className="absolute z-50 w-full mt-1.5 bg-white border border-slate-200 rounded-xl shadow-xl max-h-64 overflow-y-auto divide-y divide-slate-100 animate-in fade-in zoom-in-95 duration-100"
        >
          {/* Quick Search Hint */}
          <div className="px-3 py-1.5 bg-slate-50 text-[11px] font-medium text-slate-500 flex items-center justify-between">
            <span className="flex items-center gap-1">
              <Search className="w-3 h-3 text-slate-400" />
              البحث بالكود أو الاسم ({filteredOptions.length} نتيجة)
            </span>
            <span className="text-slate-400 text-[10px]">استخدم الأسهم ↵ للاختيار</span>
          </div>

          {filteredOptions.length === 0 ? (
            <div className="px-4 py-6 text-center text-sm text-slate-500">
              لا توجد نتائج مطابقة لـ <span className="font-semibold text-slate-800">"{searchQuery}"</span>
            </div>
          ) : (
            filteredOptions.map((opt, index) => {
              const isSelected = selectedOption?.id === opt.id;
              const isHighlighted = index === highlightedIndex;

              return (
                <div
                  key={opt.id}
                  id={id ? `${id}-option-${opt.code}` : undefined}
                  onClick={() => handleSelect(opt)}
                  onMouseEnter={() => setHighlightedIndex(index)}
                  className={`flex items-center justify-between px-3.5 py-2.5 cursor-pointer transition-colors ${
                    isSelected
                      ? 'bg-red-50 text-red-900'
                      : isHighlighted
                      ? 'bg-slate-50 text-slate-900'
                      : 'hover:bg-slate-50'
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0 flex-1">
                    {renderIcon(opt.iconType)}
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
            })
          )}
        </div>
      )}

      {/* Helper text or validation error */}
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

// =========================================================================
// Multi-Select Smart Combobox (e.g. for Workers / Multiple Furnace Cars)
// =========================================================================

interface MultiSearchableComboboxProps {
  id?: string;
  label?: string;
  placeholder?: string;
  options: ComboboxOption[];
  selectedIds: string[];
  onChange: (selectedIds: string[], selectedOptions: ComboboxOption[]) => void;
  disabled?: boolean;
  required?: boolean;
  error?: string;
  helperText?: string;
  icon?: React.ReactNode;
}

export const MultiSearchableCombobox: React.FC<MultiSearchableComboboxProps> = ({
  id,
  label,
  placeholder = 'ابحث وأضف بالكود أو بالاسم...',
  options,
  selectedIds,
  onChange,
  disabled = false,
  required = false,
  error,
  helperText,
  icon,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selectedOptions = useMemo(() => {
    return options.filter((opt) => selectedIds.includes(opt.id));
  }, [options, selectedIds]);

  const filteredOptions = useMemo(() => {
    if (!searchQuery.trim()) return options;
    return options.filter(
      (opt) =>
        matchesSearch(opt.code, searchQuery) ||
        matchesSearch(opt.name, searchQuery) ||
        (opt.subtitle && matchesSearch(opt.subtitle, searchQuery))
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

  const handleToggleOption = (option: ComboboxOption) => {
    const isSelected = selectedIds.includes(option.id);
    let nextIds: string[];
    let nextOptions: ComboboxOption[];

    if (isSelected) {
      nextIds = selectedIds.filter((id) => id !== option.id);
      nextOptions = selectedOptions.filter((opt) => opt.id !== option.id);
    } else {
      nextIds = [...selectedIds, option.id];
      nextOptions = [...selectedOptions, option];
    }

    onChange(nextIds, nextOptions);
  };

  const handleRemove = (optionId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const nextIds = selectedIds.filter((id) => id !== optionId);
    const nextOptions = selectedOptions.filter((opt) => opt.id !== optionId);
    onChange(nextIds, nextOptions);
  };

  return (
    <div id={id ? `${id}-container` : undefined} ref={containerRef} className="relative w-full">
      {label && (
        <label
          id={id ? `${id}-label` : undefined}
          className="block text-xs font-bold text-slate-700 mb-1.5 uppercase tracking-wide"
        >
          {label} {required && <span className="text-red-500">*</span>}
        </label>
      )}

      {/* Selected Chips */}
      {selectedOptions.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {selectedOptions.map((opt) => (
            <span
              key={opt.id}
              id={id ? `${id}-chip-${opt.code}` : undefined}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium bg-red-50 text-red-900 border border-red-200 shadow-2xs"
            >
              <span className="font-mono font-bold text-[11px] bg-red-100 text-red-800 px-1 py-0.5 rounded">
                {opt.code}
              </span>
              <span>{opt.name}</span>
              {!disabled && (
                <button
                  type="button"
                  onClick={(e) => handleRemove(opt.id, e)}
                  className="p-0.5 hover:bg-red-200 text-red-600 rounded-full transition-colors"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </span>
          ))}
        </div>
      )}

      {/* Trigger & Search Input */}
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
          <Search className="w-4 h-4 text-slate-400 shrink-0" />
          <input
            ref={inputRef}
            id={id ? `${id}-input` : undefined}
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onFocus={() => setIsOpen(true)}
            placeholder={placeholder}
            className="w-full bg-transparent border-none outline-none text-sm text-slate-800 placeholder-slate-400 focus:ring-0 p-0"
            disabled={disabled}
          />
        </div>

        <ChevronDown
          className={`w-4 h-4 text-slate-400 transition-transform duration-200 ms-2 ${
            isOpen ? 'transform rotate-180 text-red-500' : ''
          }`}
        />
      </div>

      {/* Dropdown Options */}
      {isOpen && !disabled && (
        <div
          id={id ? `${id}-dropdown` : undefined}
          className="absolute z-50 w-full mt-1.5 bg-white border border-slate-200 rounded-xl shadow-xl max-h-64 overflow-y-auto divide-y divide-slate-100 animate-in fade-in zoom-in-95 duration-100"
        >
          <div className="px-3 py-1.5 bg-slate-50 text-[11px] font-medium text-slate-500 flex items-center justify-between">
            <span>انقر لإضافة أو إزالة ({filteredOptions.length} متاح)</span>
            <span className="text-red-600 font-semibold">{selectedIds.length} تم اختيارهم</span>
          </div>

          {filteredOptions.length === 0 ? (
            <div className="px-4 py-6 text-center text-sm text-slate-500">
              لا توجد نتائج مطابقة لـ <span className="font-semibold text-slate-800">"{searchQuery}"</span>
            </div>
          ) : (
            filteredOptions.map((opt) => {
              const isSelected = selectedIds.includes(opt.id);

              return (
                <div
                  key={opt.id}
                  id={id ? `${id}-option-${opt.code}` : undefined}
                  onClick={() => handleToggleOption(opt)}
                  className={`flex items-center justify-between px-3.5 py-2.5 cursor-pointer transition-colors ${
                    isSelected ? 'bg-red-50/70 text-red-950 font-medium' : 'hover:bg-slate-50 text-slate-900'
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0 flex-1">
                    <div className="flex flex-col min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-mono font-bold bg-slate-100 text-slate-800 border border-slate-200">
                          {opt.code}
                        </span>
                        <span className="text-sm font-semibold truncate">{opt.name}</span>
                      </div>
                      {opt.subtitle && (
                        <span className="text-xs text-slate-500 truncate mt-0.5">{opt.subtitle}</span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 ms-3 shrink-0">
                    {opt.extraBadge && (
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-slate-100 text-slate-700">
                        {opt.extraBadge}
                      </span>
                    )}
                    <div
                      className={`w-5 h-5 rounded-md border flex items-center justify-center transition-colors ${
                        isSelected
                          ? 'bg-red-600 border-red-600 text-white'
                          : 'border-slate-300 bg-white'
                      }`}
                    >
                      {isSelected && <Check className="w-3.5 h-3.5" />}
                    </div>
                  </div>
                </div>
              );
            })
          )}
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

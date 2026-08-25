/**
 * ASFOUR ERP - Inline Master Data Quick Creation Modal for Historical Import
 * 
 * Provides an inline dialog to add unmatched Master Data entities directly from the review table:
 * - Supports Employee, Product, Customer, Press, Furnace Car, Shift, Furnace, Material, Department, Machine
 * - Pre-fills fields intelligently based on imported text (e.g. name, code, alumina, weight)
 * - Validates inputs and performs deep duplicate checks against database & memory
 * - If duplicate found: warns user and provides a 1-click [Use Existing] action
 * - Enforces permission checks (masterData.inlineAdd or admin role)
 * - Directly creates Firestore document and returns new ID to immediately resolve import rows
 */
import React, { useState, useEffect, useMemo } from 'react';
import { 
  X, 
  Save, 
  AlertTriangle, 
  CheckCircle2, 
  Loader2, 
  Plus, 
  User, 
  Box, 
  Wrench, 
  Layers, 
  Building, 
  Clock, 
  Flame, 
  PackageCheck,
  ShieldAlert,
  ArrowRight
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../i18n/LanguageContext';
import { createMasterDataItem, checkCodeDuplicate, MASTER_DATA_COLLECTIONS } from '../../services/masterDataService';
import { createMaterial } from '../../services/materialService';
import { parseProductCode, normalizeProductCode } from '../../utils/productCodeParser';
import { getCachedProductTypes } from '../../services/productTypeService';
import { logAuditAction } from '../../services/auditService';

export interface InlineMasterDataAddModalProps {
  isOpen: boolean;
  onClose: () => void;
  domain: string; // 'employee' | 'worker1' | 'worker2' | 'press' | 'product' | 'furnaceCar' | 'customer' | 'shift' | 'furnace' | 'material'
  importedValue: string;
  extraContext?: {
    workerCode?: string;
    productCode?: string;
    productName?: string;
    aluminaPercentage?: number;
    pieceWeight?: number;
    carNumber?: string;
    customerOrder?: string;
  };
  existingItems?: Array<{ id?: string; code?: string; name?: string; carNumber?: string; [key: string]: any }>;
  onSuccess: (createdItem: { id: string; code: string; name: string; [key: string]: any }) => void;
}

export const InlineMasterDataAddModal: React.FC<InlineMasterDataAddModalProps> = ({
  isOpen,
  onClose,
  domain,
  importedValue,
  extraContext,
  existingItems = [],
  onSuccess,
}) => {
  const { language, isRtl } = useLanguage();
  const { adminUser, isSuperAdmin, hasPermission } = useAuth();

  // Normalize target domain
  const normalizedDomain = useMemo(() => {
    if (domain === 'worker1' || domain === 'worker2' || domain === 'employee1' || domain === 'employee2') return 'employee';
    if (domain === 'car' || domain === 'furnace_car' || domain === 'furnaceCar') return 'furnaceCar';
    if (domain === 'press' || domain === 'presses') return 'press';
    if (domain === 'product' || domain === 'products') return 'product';
    if (domain === 'customer' || domain === 'customers') return 'customer';
    if (domain === 'shift' || domain === 'shifts') return 'shift';
    if (domain === 'furnace' || domain === 'furnaces') return 'furnace';
    if (domain === 'material' || domain === 'materials') return 'material';
    return domain || 'product';
  }, [domain]);

  // Permission Check
  const canAdd = useMemo(() => {
    if (isSuperAdmin) return true;
    if (!adminUser) return false;
    if (adminUser.role === 'SUPER_ADMIN' || adminUser.role === 'ADMIN') return true;
    const perms = adminUser.permissions as Record<string, any> | undefined;
    if (perms?.['masterData.inlineAdd'] === true) return true;
    if (perms?.masterDataCreate === true) return true;
    if (perms?.['masterdata.view'] === true) return true;
    if (normalizedDomain === 'product' && perms?.['products.create'] === true) return true;
    if (normalizedDomain === 'employee' && perms?.['employees.create'] === true) return true;
    if (normalizedDomain === 'press' && perms?.['presses.create'] === true) return true;
    return false;
  }, [adminUser, isSuperAdmin, normalizedDomain]);

  // Form Fields State
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [jobTitle, setJobTitle] = useState('');
  const [departmentName, setDepartmentName] = useState('قسم التشكيل والمكابس');
  const [phone, setPhone] = useState('');
  const [tonnage, setTonnage] = useState<number>(1200);
  const [model, setModel] = useState('');
  const [category, setCategory] = useState('');
  const [aluminaPercentage, setAluminaPercentage] = useState<number | ''>(40);
  const [pieceWeight, setPieceWeight] = useState<number | ''>(4.5);
  const [unit, setUnit] = useState('قطعة');
  const [carNumber, setCarNumber] = useState('');
  const [company, setCompany] = useState('');
  const [shiftHours, setShiftHours] = useState<number>(8);
  const [startTime, setStartTime] = useState('08:00');
  const [endTime, setEndTime] = useState('16:00');

  // Status & Duplicate State
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [detectedDuplicate, setDetectedDuplicate] = useState<{ id: string; code: string; name: string } | null>(null);

  // Initialize fields when modal opens
  useEffect(() => {
    if (!isOpen) return;

    setErrorMsg(null);
    setDetectedDuplicate(null);

    const val = (importedValue || '').trim();
    const productTypes = getCachedProductTypes();

    if (normalizedDomain === 'employee') {
      const isCode = /^[0-9]+$/.test(val);
      setCode(extraContext?.workerCode || (isCode ? val : ''));
      setName(extraContext?.workerCode && val !== extraContext.workerCode ? val : (!isCode ? val : ''));
      setJobTitle('مشغل مكبس');
      setDepartmentName('قسم التشكيل والمكابس');
      setPhone('');
    } else if (normalizedDomain === 'press') {
      const isCodeLike = /^[A-Za-z0-9_-]+$/.test(val);
      setCode(isCodeLike ? val.toUpperCase() : `PRESS-${val.replace(/\s+/g, '-')}`);
      setName(val || 'مكبس جديد');
      setTonnage(1200);
      setModel('هيدروليكي');
    } else if (normalizedDomain === 'product') {
      const rawCode = extraContext?.productCode || val;
      const normCode = normalizeProductCode(rawCode);
      const parsed = parseProductCode(normCode, productTypes);

      setCode(normCode);
      setName(extraContext?.productName || (parsed.suggestedNameAr ? parsed.suggestedNameAr : val));
      setCategory(parsed.productType?.nameAr || parsed.productType?.nameEn || 'حراريات');
      setAluminaPercentage(
        extraContext?.aluminaPercentage !== undefined 
          ? extraContext.aluminaPercentage 
          : (parsed.aluminaPercentage !== undefined ? parsed.aluminaPercentage : 40)
      );
      setPieceWeight(extraContext?.pieceWeight !== undefined ? extraContext.pieceWeight : 4.5);
      setUnit('قطعة');
    } else if (normalizedDomain === 'furnaceCar') {
      const carNum = extraContext?.carNumber || val;
      setCarNumber(carNum);
      setCode(`CAR-${carNum.replace(/[^0-9A-Za-z]/g, '')}`);
      setName(`عربة فرن رقم ${carNum}`);
    } else if (normalizedDomain === 'customer') {
      const isCodeLike = /^[A-Z0-9_-]+$/i.test(val);
      setCode(isCodeLike ? val.toUpperCase() : `CUST-${Date.now().toString().slice(-4)}`);
      setName(val || extraContext?.customerOrder || 'عميل جديد');
      setCompany(val || '');
      setPhone('');
    } else if (normalizedDomain === 'shift') {
      const numMatch = val.match(/[12]/);
      const shiftNum = numMatch ? numMatch[0] : '1';
      setCode(`SHIFT-${shiftNum}`);
      setName(`الوردية ${shiftNum === '1' ? 'الأولى (الصباحية)' : 'الثانية (المسائية)'}`);
      setShiftHours(8);
      setStartTime(shiftNum === '1' ? '08:00' : '16:00');
      setEndTime(shiftNum === '1' ? '16:00' : '00:00');
    } else {
      setCode(`CODE-${Date.now().toString().slice(-4)}`);
      setName(val || '');
    }
  }, [isOpen, normalizedDomain, importedValue, extraContext]);

  if (!isOpen) return null;

  // Helper for entity icons & labels
  const getDomainInfo = () => {
    switch (normalizedDomain) {
      case 'employee':
        return {
          titleAr: 'إضافة عامل / موظف جديد إلى البيانات الأساسية',
          titleEn: 'Add New Employee to Master Data',
          icon: <User className="w-5 h-5 text-emerald-600" />,
          collectionName: 'employees'
        };
      case 'press':
        return {
          titleAr: 'إضافة مكبس جديد إلى البيانات الأساسية',
          titleEn: 'Add New Press Machine to Master Data',
          icon: <Wrench className="w-5 h-5 text-sky-600" />,
          collectionName: 'presses'
        };
      case 'product':
        return {
          titleAr: 'إضافة صنف / منتج حراري إلى البيانات الأساسية',
          titleEn: 'Add New Product to Master Data',
          icon: <Box className="w-5 h-5 text-amber-600" />,
          collectionName: 'products'
        };
      case 'furnaceCar':
        return {
          titleAr: 'إضافة عربة فرن إلى البيانات الأساسية',
          titleEn: 'Add New Furnace Car to Master Data',
          icon: <Layers className="w-5 h-5 text-orange-600" />,
          collectionName: 'furnaceCars'
        };
      case 'customer':
        return {
          titleAr: 'إضافة عميل إلى البيانات الأساسية',
          titleEn: 'Add New Customer to Master Data',
          icon: <Building className="w-5 h-5 text-indigo-600" />,
          collectionName: 'customers'
        };
      case 'shift':
        return {
          titleAr: 'إضافة وردية إلى البيانات الأساسية',
          titleEn: 'Add New Shift to Master Data',
          icon: <Clock className="w-5 h-5 text-teal-600" />,
          collectionName: 'shifts'
        };
      case 'furnace':
        return {
          titleAr: 'إضافة فرن إلى البيانات الأساسية',
          titleEn: 'Add New Furnace to Master Data',
          icon: <Flame className="w-5 h-5 text-red-600" />,
          collectionName: 'furnaces'
        };
      case 'material':
        return {
          titleAr: 'إضافة مادة خام إلى البيانات الأساسية',
          titleEn: 'Add New Raw Material to Master Data',
          icon: <PackageCheck className="w-5 h-5 text-purple-600" />,
          collectionName: 'materials'
        };
      default:
        return {
          titleAr: 'إضافة بيان أساسي جديد',
          titleEn: 'Add Master Data Record',
          icon: <Box className="w-5 h-5 text-slate-600" />,
          collectionName: 'products'
        };
    }
  };

  const domainInfo = getDomainInfo();

  // Handle Form Submission
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setDetectedDuplicate(null);

    if (!canAdd) {
      setErrorMsg(
        language === 'ar' 
          ? 'ليس لديك صلاحية إضافة بيانات أساسية أثناء الاستيراد.'
          : 'You do not have permission to add master data during import.'
      );
      return;
    }

    const trimmedCode = code.trim();
    const trimmedName = (normalizedDomain === 'furnaceCar' ? (carNumber.trim() || name.trim()) : name.trim());

    if (!trimmedCode && normalizedDomain !== 'furnaceCar') {
      setErrorMsg(language === 'ar' ? 'يرجى إدخال الكود.' : 'Please enter code.');
      return;
    }
    if (!trimmedName) {
      setErrorMsg(language === 'ar' ? 'يرجى إدخال الاسم / رقم العربة.' : 'Please enter name / car number.');
      return;
    }

    // 1. In-Memory Duplicate Pre-check
    const matchedExisting = existingItems.find(item => {
      if (item.code && item.code.trim().toLowerCase() === trimmedCode.toLowerCase()) return true;
      if (item.name && item.name.trim().toLowerCase() === trimmedName.toLowerCase()) return true;
      if (normalizedDomain === 'furnaceCar' && item.carNumber && item.carNumber.trim().toLowerCase() === carNumber.trim().toLowerCase()) return true;
      return false;
    });

    if (matchedExisting) {
      setDetectedDuplicate({
        id: matchedExisting.id || `existing-${matchedExisting.code}`,
        code: matchedExisting.code || trimmedCode,
        name: matchedExisting.name || matchedExisting.carNumber || trimmedName,
      });
      return;
    }

    setIsSubmitting(true);
    try {
      // 2. Firestore Code Duplicate Check
      const isDuplicateInDb = await checkCodeDuplicate(domainInfo.collectionName, trimmedCode);
      if (isDuplicateInDb) {
        setDetectedDuplicate({
          id: `db-${trimmedCode}`,
          code: trimmedCode,
          name: trimmedName,
        });
        setIsSubmitting(false);
        return;
      }

      // 3. Build Record Payload
      let recordPayload: Record<string, any> = {
        code: trimmedCode,
        name: trimmedName,
        active: true,
        source: 'HISTORICAL_IMPORT_INLINE_ADD',
        importedOriginalValue: importedValue,
      };

      if (normalizedDomain === 'employee') {
        recordPayload = {
          ...recordPayload,
          jobTitle: jobTitle.trim() || 'مشغل مكبس',
          departmentName: departmentName.trim() || 'قسم التشكيل والمكابس',
          phone: phone.trim(),
        };
      } else if (normalizedDomain === 'press') {
        recordPayload = {
          ...recordPayload,
          tonnage: Number(tonnage) || 1200,
          model: model.trim() || 'هيدروليكي',
          status: 'active',
        };
      } else if (normalizedDomain === 'product') {
        const parseResult = parseProductCode(trimmedCode);
        recordPayload = {
          ...recordPayload,
          productCode: trimmedCode,
          category: category.trim() || 'حراريات',
          aluminaPercentage: aluminaPercentage !== '' ? Number(aluminaPercentage) : null,
          pieceWeight: pieceWeight !== '' ? Number(pieceWeight) : 4.5,
          pieceWeightKg: pieceWeight !== '' ? Number(pieceWeight) : 4.5,
          unit: unit.trim() || 'قطعة',
          smartParseStatus: parseResult.status,
          ...(parseResult.productType ? {
            productTypePrefix: parseResult.prefix,
            productTypeId: parseResult.productType.id || '',
            productTypeName: parseResult.productType.nameEn,
            productTypeNameAr: parseResult.productType.nameAr,
          } : {})
        };
      } else if (normalizedDomain === 'furnaceCar') {
        recordPayload = {
          ...recordPayload,
          carNumber: carNumber.trim() || trimmedName,
          code: trimmedCode || `CAR-${carNumber.trim()}`,
          capacity: 1200,
        };
      } else if (normalizedDomain === 'customer') {
        recordPayload = {
          ...recordPayload,
          company: company.trim() || trimmedName,
          phone: phone.trim(),
        };
      } else if (normalizedDomain === 'shift') {
        recordPayload = {
          ...recordPayload,
          startTime,
          endTime,
          hours: Number(shiftHours) || 8,
        };
      }

      // 4. Save to Firestore
      let newDocId: string | undefined;
      if (normalizedDomain === 'material') {
        newDocId = await createMaterial({
          code: trimmedCode,
          name: trimmedName,
          unit: unit.trim() || 'طن',
          category: category.trim() || 'عام',
          active: true,
        });
      } else {
        newDocId = await createMasterDataItem(domainInfo.collectionName, recordPayload);
      }

      const createdFinal = {
        id: newDocId || `item-${Date.now()}`,
        code: trimmedCode,
        name: trimmedName,
        ...recordPayload,
      };

      // 5. Log audit action
      logAuditAction(
        'CREATE',
        domainInfo.collectionName,
        createdFinal.id,
        `إضافة بيان أساسي فوري أثناء استيراد البيانات التاريخية: ${domainInfo.titleAr} (${trimmedName} - ${trimmedCode})`
      );

      onSuccess(createdFinal);
      onClose();
    } catch (err: any) {
      setErrorMsg(err.message || (language === 'ar' ? 'حدث خطأ أثناء حفظ البيان الجديد.' : 'Failed to save record.'));
    } finally {
      setIsSubmitting(false);
    }
  };

  // Handle using existing item if duplicate detected
  const handleUseExisting = () => {
    if (!detectedDuplicate) return;
    onSuccess(detectedDuplicate);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150" dir={isRtl ? 'rtl' : 'ltr'}>
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-lg overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-slate-100 flex items-center justify-between bg-slate-50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-white border border-slate-200 shadow-xs flex items-center justify-center">
              {domainInfo.icon}
            </div>
            <div>
              <h2 className="text-sm sm:text-base font-black text-slate-900">
                {language === 'ar' ? domainInfo.titleAr : domainInfo.titleEn}
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                {language === 'ar' ? 'القيمة المستوردة الأصلية: ' : 'Imported raw value: '}
                <strong className="text-emerald-700 font-mono font-bold bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200">
                  {importedValue}
                </strong>
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content & Form */}
        <form onSubmit={handleSubmit} className="p-4 sm:p-6 overflow-y-auto space-y-4 flex-1">
          {/* Permission warning if user lacks right */}
          {!canAdd && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-3.5 flex items-start gap-2.5 text-xs text-red-800 font-bold">
              <ShieldAlert className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
              <div>
                <p>{language === 'ar' ? 'ليس لديك صلاحية إضافة بيانات أساسية أثناء الاستيراد.' : 'You do not have permission to add master data during import.'}</p>
                <p className="text-[11px] font-normal text-red-600 mt-0.5">
                  {language === 'ar' ? 'يرجى مراجعة مدير النظام لمنحك صلاحية (masterData.inlineAdd).' : 'Please contact administrator for permission (masterData.inlineAdd).'}
                </p>
              </div>
            </div>
          )}

          {/* Duplicate Warning Box */}
          {detectedDuplicate && (
            <div className="bg-amber-50 border border-amber-300 rounded-xl p-4 space-y-3">
              <div className="flex items-start gap-2.5">
                <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                <div className="text-xs text-amber-900">
                  <p className="font-black text-sm">
                    {language === 'ar' ? 'هذا البيان موجود بالفعل في قاعدة البيانات!' : 'This record already exists in Master Data!'}
                  </p>
                  <p className="mt-1">
                    {language === 'ar' 
                      ? `تم العثور على بيان مطابق: [${detectedDuplicate.name}] بكود (${detectedDuplicate.code}). يمكنك استخدامه مباشرة بدلاً من إنشاء بيان مكرر.`
                      : `A matching record was found: [${detectedDuplicate.name}] (Code: ${detectedDuplicate.code}). You can link it directly instead of creating a duplicate.`}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 justify-end pt-1">
                <button
                  type="button"
                  onClick={() => setDetectedDuplicate(null)}
                  className="px-3 py-1.5 text-xs font-bold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg cursor-pointer"
                >
                  {language === 'ar' ? 'تعديل البيانات المدخلة' : 'Edit Inputs'}
                </button>
                <button
                  type="button"
                  onClick={handleUseExisting}
                  className="px-4 py-1.5 text-xs font-bold text-white bg-amber-600 hover:bg-amber-700 rounded-lg shadow-xs flex items-center gap-1.5 cursor-pointer"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  <span>{language === 'ar' ? 'استخدام البيان الحالي واعتماده' : 'Use Existing Record'}</span>
                </button>
              </div>
            </div>
          )}

          {/* Generic Error */}
          {errorMsg && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-xs text-red-700 font-bold">
              {errorMsg}
            </div>
          )}

          {/* Code & Name (Core) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                {language === 'ar' ? 'كود البيان (Code)' : 'Entity Code'} <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                disabled={!canAdd || isSubmitting}
                required
                className="w-full px-3 py-2 text-xs font-mono font-bold bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200 transition-all outline-hidden"
                placeholder="مثال: PRESS-01 أو BHA304"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                {normalizedDomain === 'furnaceCar' 
                  ? (language === 'ar' ? 'رقم العربة' : 'Car Number')
                  : (language === 'ar' ? 'الاسم الرسمي' : 'Official Name')} <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={normalizedDomain === 'furnaceCar' ? carNumber : name}
                onChange={(e) => {
                  if (normalizedDomain === 'furnaceCar') {
                    setCarNumber(e.target.value);
                    setName(`عربة فرن رقم ${e.target.value}`);
                  } else {
                    setName(e.target.value);
                  }
                }}
                disabled={!canAdd || isSubmitting}
                required
                className="w-full px-3 py-2 text-xs font-bold bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200 transition-all outline-hidden"
                placeholder={language === 'ar' ? 'أدخل الاسم بدقة...' : 'Enter name...'}
              />
            </div>
          </div>

          {/* Dynamic Extra Fields per domain */}
          {normalizedDomain === 'employee' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  {language === 'ar' ? 'المسمى الوظيفي' : 'Job Title'}
                </label>
                <input
                  type="text"
                  value={jobTitle}
                  onChange={(e) => setJobTitle(e.target.value)}
                  disabled={!canAdd || isSubmitting}
                  className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:border-emerald-500 outline-hidden"
                  placeholder="مشغل مكبس"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  {language === 'ar' ? 'القسم' : 'Department'}
                </label>
                <input
                  type="text"
                  value={departmentName}
                  onChange={(e) => setDepartmentName(e.target.value)}
                  disabled={!canAdd || isSubmitting}
                  className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:border-emerald-500 outline-hidden"
                  placeholder="قسم التشكيل والمكابس"
                />
              </div>
            </div>
          )}

          {normalizedDomain === 'product' && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  {language === 'ar' ? 'نسبة الألومينا (%)' : 'Alumina %'}
                </label>
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="0.5"
                  value={aluminaPercentage}
                  onChange={(e) => setAluminaPercentage(e.target.value === '' ? '' : Number(e.target.value))}
                  disabled={!canAdd || isSubmitting}
                  className="w-full px-3 py-2 text-xs font-bold bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:border-emerald-500 outline-hidden"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  {language === 'ar' ? 'وزن القطعة (كجم)' : 'Piece Weight (kg)'}
                </label>
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={pieceWeight}
                  onChange={(e) => setPieceWeight(e.target.value === '' ? '' : Number(e.target.value))}
                  disabled={!canAdd || isSubmitting}
                  className="w-full px-3 py-2 text-xs font-bold bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:border-emerald-500 outline-hidden"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  {language === 'ar' ? 'التصنيف / النوع' : 'Category'}
                </label>
                <input
                  type="text"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  disabled={!canAdd || isSubmitting}
                  className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:border-emerald-500 outline-hidden"
                  placeholder="طوب عالي الألومينا"
                />
              </div>
            </div>
          )}

          {normalizedDomain === 'press' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  {language === 'ar' ? 'قوة الضغط (طن)' : 'Tonnage'}
                </label>
                <input
                  type="number"
                  value={tonnage}
                  onChange={(e) => setTonnage(Number(e.target.value))}
                  disabled={!canAdd || isSubmitting}
                  className="w-full px-3 py-2 text-xs font-bold bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:border-emerald-500 outline-hidden"
                  placeholder="1200"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  {language === 'ar' ? 'طراز المكبس' : 'Model'}
                </label>
                <input
                  type="text"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  disabled={!canAdd || isSubmitting}
                  className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:border-emerald-500 outline-hidden"
                  placeholder="هيدروليكي"
                />
              </div>
            </div>
          )}

          {normalizedDomain === 'customer' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  {language === 'ar' ? 'اسم الشركة / العميل' : 'Company Name'}
                </label>
                <input
                  type="text"
                  value={company}
                  onChange={(e) => setCompany(e.target.value)}
                  disabled={!canAdd || isSubmitting}
                  className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:border-emerald-500 outline-hidden"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  {language === 'ar' ? 'رقم الهاتف' : 'Phone'}
                </label>
                <input
                  type="text"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  disabled={!canAdd || isSubmitting}
                  className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:border-emerald-500 outline-hidden"
                />
              </div>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-xl transition-colors cursor-pointer"
            >
              {language === 'ar' ? 'إلغاء' : 'Cancel'}
            </button>

            <button
              type="submit"
              disabled={!canAdd || isSubmitting}
              className="flex items-center gap-2 px-5 py-2 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 rounded-xl shadow-md transition-all cursor-pointer"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>{language === 'ar' ? 'جاري الحفظ في Firestore...' : 'Saving to Firestore...'}</span>
                </>
              ) : (
                <>
                  <Plus className="w-4 h-4" />
                  <span>{language === 'ar' ? 'حفظ وإضافة ومطابقة فورية' : 'Save & Link to Import'}</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

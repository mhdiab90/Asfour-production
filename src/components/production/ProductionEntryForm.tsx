/**
 * Production Entry Form Component
 *
 * Features:
 * - Smart Searchable Comboboxes (Search by Code OR Name seamlessly)
 * - Single-select for Shift, Press, Furnace, Product, Customer
 * - Multi-select for Workers/Employees and Furnace Cars with code & name chips
 * - Contextual Furnace Car filtering based on selected Furnace
 * - Instant calculation of Good Quantity, Waste %, Production Weight (kg & tons), and Downtime
 * - Comprehensive snapshot storage (stable IDs + human-readable identifiers and names)
 */
import React, { useState, useEffect, useMemo } from 'react';
import {
  Factory,
  Clock,
  Wrench,
  Flame,
  Truck,
  Users,
  Box,
  Building,
  Calculator,
  AlertCircle,
  CheckCircle2,
  HelpCircle,
  RotateCcw,
  Sparkles,
  Info
} from 'lucide-react';
import {
  Shift,
  Press,
  Furnace,
  FurnaceCar,
  Product,
  Customer,
  Employee,
  NavigationPage,
  FormingMethod
} from '../../types';
import { fetchMasterData } from '../../services/masterDataService';
import { createProductionRecord, calculateProductionMetrics } from '../../services/productionService';
// Phase 1 Step 5A: optional job / batch / operation references, validated before the existing write.
import { attachProductionReferences } from '../../services/productionReferenceService';
import type { ProductionReferenceSelection } from '../../services/productionReferencePure';
import { describeProductionReferences } from '../../services/productionReferencePure';
import { prepareActualConsumption } from '../../services/actualConsumptionService';
// Phase 1 Step 6: production outputs + input batches (genealogy), validated before the existing write.
import { prepareProductionGenealogy } from '../../services/productionGenealogyService';
import type { ProductionGenealogySelection } from '../../services/productionGenealogyPure';
import { describeOutputChange } from '../../services/productionGenealogyPure';
import { formatNumber, formatDecimal } from '../../utils/formatters';
import { SearchableCombobox, MultiSearchableCombobox, ComboboxOption } from '../common/SearchableCombobox';
import { Modal } from '../common/Modal';
import { evaluateProductionWarnings, ValidationResult } from '../../utils/businessValidationRules';
import { logAuditAction } from '../../services/auditService';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../i18n/LanguageContext';

interface ProductionEntryFormProps {
  onNavigate: (page: NavigationPage) => void;
  onSuccess?: () => void;
  productionReferences?: ProductionReferenceSelection;
  productionGenealogy?: ProductionGenealogySelection;
}

export const ProductionEntryForm: React.FC<ProductionEntryFormProps> = ({ onNavigate, onSuccess, productionReferences, productionGenealogy }) => {
  const { isSuperAdmin, hasPermission } = useAuth();
  const canOverrideWarnings = isSuperAdmin || hasPermission('validation.overrideWarnings');
  const { language, isRtl } = useLanguage();

  // Master data state
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [presses, setPresses] = useState<Press[]>([]);
  const [furnaces, setFurnaces] = useState<Furnace[]>([]);
  const [furnaceCars, setFurnaceCars] = useState<FurnaceCar[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [isLoadingData, setIsLoadingData] = useState<boolean>(true);

  // Form selections & values - Starts completely empty for a clean new production record
  const [date, setDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [shiftId, setShiftId] = useState<string>('');
  const [pressId, setPressId] = useState<string>('');
  const [furnaceId, setFurnaceId] = useState<string>('');
  // Each selected Furnace Car carries its OWN Brick Count (not a plain code
  // list) - brickCount is transactional/production data, never Master Data.
  const [selectedFurnaceCarEntries, setSelectedFurnaceCarEntries] = useState<Array<{ carId: string; brickCount: string }>>([]);
  const [lastAddedFurnaceCarId, setLastAddedFurnaceCarId] = useState<string | null>(null);
  const [selectedEmployeeIds, setSelectedEmployeeIds] = useState<string[]>([]);
  const [customerId, setCustomerId] = useState<string>('');
  const [customerOrderNumber, setCustomerOrderNumber] = useState<string>('');
  const [productId, setProductId] = useState<string>('');
  const [aluminaPercentage, setAluminaPercentage] = useState<number>(0);
  const [pieceWeight, setPieceWeight] = useState<number>(0);

  // Quantities - Starts empty (0) for new entry
  const [productionQuantity, setProductionQuantity] = useState<number>(0);
  const [wasteQuantity, setWasteQuantity] = useState<number>(0);

  // Faults / Downtime in minutes - Starts empty (0)
  const [mechanicalFaults, setMechanicalFaults] = useState<number>(0);
  const [electricalFaults, setElectricalFaults] = useState<number>(0);
  const [workshopFaults, setWorkshopFaults] = useState<number>(0);
  const [rawMaterialFaults, setRawMaterialFaults] = useState<number>(0);
  const [furnaceFaults, setFurnaceFaults] = useState<number>(0);
  const [pressFaults, setPressFaults] = useState<number>(0);
  const [otherFaults, setOtherFaults] = useState<number>(0);

  // Business (non-blocking) warnings pending explicit user confirmation (§3/§7/§29)
  const [pendingWarnings, setPendingWarnings] = useState<ValidationResult[]>([]);

  const [notes, setNotes] = useState<string>('');
  /** Phase 1 Step 8C-5: extrusion is recorded here, on the pressing record (absent = pressing). */
  const [formingMethod, setFormingMethod] = useState<FormingMethod>('PRESSING');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const tr = {
    hours: language === 'ar' ? 'ساعات' : 'hours',
    capacity: language === 'ar' ? 'سعة' : 'Capacity',
    ton: language === 'ar' ? 'طن' : 't',
    maxTemp: language === 'ar' ? 'حرارة قصوى' : 'Max Temp',
    carNumber: language === 'ar' ? 'عربة رقم' : 'Car #',
    furnaceLabel: language === 'ar' ? 'الفرن' : 'Furnace',
    department: language === 'ar' ? 'القسم' : 'Dept.',
    productionDept: language === 'ar' ? 'الإنتاج' : 'Production',
    thermalProduct: language === 'ar' ? 'منتج حراري' : 'Thermal Product',
    thermalBrick: language === 'ar' ? 'طوب حراري' : 'Thermal Brick',
    alumina: language === 'ar' ? 'ألومينا' : 'Alumina',
    manualCode: language === 'ar' ? 'كود يدوي' : 'Manual Code',
    weight: language === 'ar' ? 'وزن' : 'Weight',
    kg: language === 'ar' ? 'كجم' : 'kg',
    manual: language === 'ar' ? 'يدوي' : 'Manual',
    customer: language === 'ar' ? 'عميل' : 'Customer',
    company: language === 'ar' ? 'شركة' : 'Company',
    phone: language === 'ar' ? 'هاتف' : 'Phone',
    carAlreadyAdded: language === 'ar' ? 'مضافة بالفعل.' : 'is already added.',
    car: language === 'ar' ? 'العربة' : 'Car',
    selectDate: language === 'ar' ? 'يرجى تحديد تاريخ عملية الإنتاج.' : 'Please select the production operation date.',
    selectShift: language === 'ar' ? 'يرجى اختيار وردية العمل.' : 'Please select the work shift.',
    selectPress: language === 'ar' ? 'يرجى اختيار المكبس.' : 'Please select the press.',
    selectProduct: language === 'ar' ? 'يرجى اختيار المنتج الحراري.' : 'Please select the thermal product.',
    productionQtyPositive: language === 'ar' ? 'إجمالي كمية الإنتاج المكبوسة يجب أن تكون أكبر من الصفر.' : 'Total pressed production quantity must be greater than zero.',
    selectPieceWeight: language === 'ar' ? 'يرجى تحديد وزن القطعة بالكيلوجرام.' : 'Please specify the piece weight in kilograms.',
    brickCountRequired: language === 'ar' ? 'يجب إدخال عدد الطوب للعربة' : 'Brick count is required for car',
    brickCountForCar: language === 'ar' ? 'عدد الطوب للعربة' : 'Brick count for car',
    brickCountInteger: language === 'ar' ? 'يجب أن يكون رقماً صحيحاً غير سالب.' : 'must be a non-negative whole number.',
    mainShift: language === 'ar' ? 'وردية رئيسية' : 'Main Shift',
    press: language === 'ar' ? 'مكبس' : 'Press',
    savedSuccess: language === 'ar' ? 'تم تسجيل وحفظ عملية الإنتاج بنجاح في قاعدة بيانات Firestore السحابية!' : 'Production operation recorded and saved successfully to the Firestore cloud database!',
    saveError: language === 'ar' ? 'حدث خطأ أثناء حفظ سجل الإنتاج.' : 'An error occurred while saving the production record.',
    headerTitle: language === 'ar' ? 'تسجيل ومطابقة عمليات الإنتاج اليومية' : 'Daily Production Entry & Matching',
    headerSubtitle: language === 'ar' ? 'البحث الذكي الموحد بالكود أو بالاسم مع احتساب فوري للهالك والأوزان الصافية ومزامنة Firestore' : 'Unified smart search by code or name with instant waste/net-weight calculation and Firestore sync',
    resetTitle: language === 'ar' ? 'تفريغ كافة الحقول لبدء تشغيلة جديدة' : 'Clear all fields to start a new operation',
    newRecordBtn: language === 'ar' ? 'سجل إنتاج جديد (تفريغ الحقول)' : 'New Production Record (Clear Fields)',
    viewAllRecords: language === 'ar' ? 'عرض كافة السجلات' : 'View All Records',
    clearedFullyNote: language === 'ar' ? 'تم تفريغ الحقول بالكامل وجاهز لتسجيل التشغيلة التالية مباشرة.' : 'All fields have been fully cleared and are ready for the next entry.',
    goToRecordsTable: language === 'ar' ? 'انتقال إلى جدول السجلات' : 'Go to Records Table',
    recordAnother: language === 'ar' ? 'تسجيل تشغيلة أخرى' : 'Record Another Entry',
    dataEntryError: language === 'ar' ? 'خطأ في إدخال البيانات' : 'Data Entry Error',
    section1Title: language === 'ar' ? '1. الوردية والمعدات والتجهيزات (البحث الذكي بالكود أو الاسم)' : '1. Shift, Equipment & Setup (Smart Search by Code or Name)',
    instantSearch: language === 'ar' ? 'بحث فوري فائق السرعة' : 'Ultra-fast instant search',
    productionDate: language === 'ar' ? 'تاريخ الإنتاج' : 'Production Date',
    shiftLabel: language === 'ar' ? 'الوردية' : 'Shift',
    chooseByCodeOrName: language === 'ar' ? 'اختر بالكود أو الاسم...' : 'Choose by code or name...',
    pressLabel: language === 'ar' ? 'المكبس' : 'Press',
    searchByPressCodeOrName: language === 'ar' ? 'ابحث بكود أو اسم المكبس...' : 'Search by press code or name...',
    furnaceOptional: language === 'ar' ? 'الفرن (اختياري)' : 'Furnace (optional)',
    searchByFurnaceCodeOrName: language === 'ar' ? 'ابحث بكود أو اسم الفرن...' : 'Search by furnace code or name...',
    addFurnaceCar: language === 'ar' ? 'إضافة عربة فرن للتشغيلة:' : 'Add a furnace car to this entry:',
    searchByCarNumberOrCode: language === 'ar' ? 'ابحث برقم العربة أو الكود لإضافتها...' : 'Search by car number or code to add it...',
    autoFilteredCars: (name: string) => language === 'ar' ? `تم تصفية العربات المتاحة تلقائياً للفرن المختار (${name})` : `Available cars auto-filtered for the selected furnace (${name})`,
    chooseFurnaceToFilter: language === 'ar' ? 'اختر الفرن لتصفية العربات، أو أضف أي عربة متاحة. اضغط Enter لإضافة العربة المظللة.' : 'Choose a furnace to filter cars, or add any available car. Press Enter to add the highlighted car.',
    removeCar: language === 'ar' ? 'إزالة العربة' : 'Remove Car',
    brickCountLabel: language === 'ar' ? 'عدد الطوب:' : 'Brick Count:',
    brickCountExample: language === 'ar' ? 'مثال: 453' : 'e.g. 453',
    section2Title: language === 'ar' ? '2. فريق العمل والقائمون بالتشغيل (بحث بالكود أو الاسم)' : '2. Work Team & Operators (Search by Code or Name)',
    selectedWorkers: (n: number) => language === 'ar' ? `تم تحديد (${n}) عامل` : `${n} worker(s) selected`,
    addWorkers: language === 'ar' ? 'إضافة عمال التشغيل:' : 'Add operating workers:',
    searchWorkerPlaceholder: language === 'ar' ? 'ابحث بكود العامل (مثال E001) أو باسمه (مثال أحمد علي)...' : 'Search by worker code (e.g. E001) or name...',
    searchWorkerHelper: language === 'ar' ? 'يمكنك البحث عن أي عامل بكوده أو اسمه وإضافته بضغطة زر، وتظهر بطاقات العمال متضمنة الكود والاسم والقسم.' : 'Search for any worker by code or name and add them with one click; worker cards show code, name, and department.',
    section3Title: language === 'ar' ? '3. المنتج الحراري، العميل، والمواصفات الفنية' : '3. Thermal Product, Customer & Technical Specs',
    productLabel: language === 'ar' ? 'المنتج الحراري' : 'Thermal Product',
    searchProductPlaceholder: language === 'ar' ? 'ابحث بكود المنتج (مثال BAR250102305) أو بالاسم...' : 'Search by product code (e.g. BAR250102305) or name...',
    aluminaLabel: language === 'ar' ? 'نسبة الألومينا (%)' : 'Alumina Percentage (%)',
    pieceWeightLabel: language === 'ar' ? 'وزن القطعة (كجم)' : 'Piece Weight (kg)',
    customerLabel: language === 'ar' ? 'العميل / الشركة (اختياري)' : 'Customer / Company (optional)',
    searchCustomerPlaceholder: language === 'ar' ? 'ابحث بكود العميل أو اسم الشركة...' : 'Search by customer code or company name...',
    orderNumberLabel: language === 'ar' ? 'رقم أمر التشغيل / التوريد' : 'Work / Supply Order Number',
    orderNumberExample: language === 'ar' ? 'مثال: ORD-2026-8801' : 'e.g. ORD-2026-8801',
    directMatchSummary: language === 'ar' ? 'المطابقة المباشرة للتشغيلة:' : 'Direct entry matching:',
    section4Title: language === 'ar' ? '4. كميات الإنتاج والحسابات الهندسية التلقائية' : '4. Production Quantities & Automatic Engineering Calculations',
    preciseFormulas: language === 'ar' ? 'معادلات فورية دقيقة' : 'Precise live formulas',
    totalProductionQty: language === 'ar' ? 'إجمالي كمية الإنتاج المكبوسة (قطع)' : 'Total Pressed Production Quantity (pcs)',
    wasteQtyLabel: language === 'ar' ? 'كمية الهالك والتالف (قطع)' : 'Waste & Damaged Quantity (pcs)',
    goodProductionPcs: language === 'ar' ? 'الإنتاج السليم (قطع)' : 'Good Production (pcs)',
    wastePercentLabel: language === 'ar' ? 'نسبة الهالك (%)' : 'Waste Rate (%)',
    totalWeightLabel: language === 'ar' ? 'إجمالي الوزن (كجم / طن)' : 'Total Weight (kg / t)',
    goodNetWeightLabel: language === 'ar' ? 'الوزن السليم الصافي' : 'Net Good Weight',
    section5Title: language === 'ar' ? '5. فئات الأعطال والتوقفات (بالدقائق)' : '5. Fault Categories & Downtime (minutes)',
    totalDowntime: (min: number, hr: number) => language === 'ar' ? `إجمالي التوقف: ${min} دقيقة (${hr} ساعة)` : `Total Downtime: ${min} min (${hr} hr)`,
    faultMechanical: language === 'ar' ? 'ميكانيكية' : 'Mechanical',
    faultElectrical: language === 'ar' ? 'كهربائية' : 'Electrical',
    faultWorkshop: language === 'ar' ? 'ورشة' : 'Workshop',
    faultRawMaterial: language === 'ar' ? 'خامات' : 'Raw Material',
    faultFurnace: language === 'ar' ? 'فرن' : 'Furnace',
    faultPress: language === 'ar' ? 'مكبس' : 'Press',
    faultOther: language === 'ar' ? 'أخرى' : 'Other',
    notesLabel: language === 'ar' ? 'ملاحظات التشغيل والتوقفات' : 'Operation & Downtime Notes',
    notesPlaceholder: language === 'ar' ? 'أي تفاصيل إضافية حول أسباب التوقف أو جودة خلطة الحراريات...' : 'Any additional details about downtime causes or refractory mix quality...',
    cancel: language === 'ar' ? 'إلغاء' : 'Cancel',
    savingCloud: language === 'ar' ? 'جاري الحفظ والمزامنة السحابية...' : 'Saving & syncing to cloud...',
    saveAndMatch: language === 'ar' ? 'حفظ ومطابقة سجل الإنتاج' : 'Save & Match Production Record',
    warningsTitle: (n: number) => language === 'ar' ? `⚠️ ${n > 1 ? 'تحذيرات' : 'تحذير'}` : `⚠️ ${n > 1 ? 'Warnings' : 'Warning'}`,
    stillValidNote: language === 'ar' ? 'السجل يبقى صالحًا من الناحية الفنية ويمكن حفظه كما هو دون أي تعديل على القيم المدخلة.' : 'The record remains technically valid and can be saved as-is without altering any entered values.',
    noOverridePermission: language === 'ar' ? 'لا تملك صلاحية "تسجيل رغم التحذير" - يمكنك تعديل البيانات فقط.' : 'You do not have "Save Despite Warning" permission - you may only edit the data.',
    editData: language === 'ar' ? 'تعديل البيانات' : 'Edit Data',
    saveDespiteWarning: language === 'ar' ? 'تسجيل رغم التحذير' : 'Save Despite Warning',
  };

  /**
   * Authoritative Form Reset Function
   * Resets ALL production-entry state to a pristine, clean new record state.
   * Clears: employees, furnace cars, press, furnace, customer, order, shift, product,
   * alumina, piece weight, quantities, faults, notes, errors, and resets focus.
   */
  const resetProductionForm = (preserveDate: boolean = true) => {
    if (!preserveDate) {
      setDate(new Date().toISOString().split('T')[0]);
    }
    setShiftId('');
    setPressId('');
    setFurnaceId('');
    setSelectedFurnaceCarEntries([]);
    setSelectedEmployeeIds([]);
    setCustomerId('');
    setCustomerOrderNumber('');
    setProductId('');
    setAluminaPercentage(0);
    setPieceWeight(0);
    setProductionQuantity(0);
    setWasteQuantity(0);
    setMechanicalFaults(0);
    setElectricalFaults(0);
    setWorkshopFaults(0);
    setRawMaterialFaults(0);
    setFurnaceFaults(0);
    setPressFaults(0);
    setOtherFaults(0);
    setNotes('');
    setFormingMethod('PRESSING');
    setErrorMessage(null);

    // Focus the first logical input for instant continuous entry
    setTimeout(() => {
      const firstInput = document.getElementById('production-date-input') || document.getElementById('shift-select-trigger');
      firstInput?.focus();
    }, 50);
  };

  // Load active master data on mount without auto-filling default selections
  useEffect(() => {
    async function loadAllMasterData() {
      setIsLoadingData(true);
      try {
        const [sList, pList, fList, fcList, prodList, cList, eList] = await Promise.all([
          fetchMasterData<Shift>('shifts'),
          fetchMasterData<Press>('presses'),
          fetchMasterData<Furnace>('furnaces'),
          fetchMasterData<FurnaceCar>('furnaceCars'),
          fetchMasterData<Product>('products'),
          fetchMasterData<Customer>('customers'),
          fetchMasterData<Employee>('employees'),
        ]);

        const activeShifts = sList.filter((s) => s.active !== false);
        const activePresses = pList.filter((p) => p.active !== false);
        const activeFurnaces = fList.filter((f) => f.active !== false);
        const activeCars = fcList.filter((fc) => fc.active !== false);
        const activeProducts = prodList.filter((pr) => pr.active !== false);
        const activeCustomers = cList.filter((c) => c.active !== false);
        const activeEmployees = eList.filter((e) => e.active !== false);

        setShifts(activeShifts);
        setPresses(activePresses);
        setFurnaces(activeFurnaces);
        setFurnaceCars(activeCars);
        setProducts(activeProducts);
        setCustomers(activeCustomers);
        setEmployees(activeEmployees);

        // DO NOT auto-select shift, press, or product - Keep form pristine & empty
      } catch (err) {
        console.error('Error loading master data:', err);
      } finally {
        setIsLoadingData(false);
      }
    }

    loadAllMasterData();
  }, []);

  // When Product is selected via Combobox
  const handleProductSelect = (selectedId: string | null, option?: ComboboxOption) => {
    setProductId(selectedId || '');
    if (selectedId) {
      const prod = products.find((p) => p.id === selectedId);
      if (prod) {
        setAluminaPercentage(prod.aluminaPercentage ?? 0);
        if (prod.pieceWeight || prod.pieceWeightKg) {
          setPieceWeight(prod.pieceWeight || prod.pieceWeightKg || 0);
        }
      }
    } else {
      setAluminaPercentage(0);
      setPieceWeight(0);
    }
  };

  // When Furnace is selected, filter cars belonging to that furnace (if specified)
  const availableFurnaceCars = useMemo(() => {
    if (!furnaceId) return furnaceCars;
    const matched = furnaceCars.filter(
      (c) => c.furnaceId === furnaceId || !c.furnaceId
    );
    return matched.length > 0 ? matched : furnaceCars;
  }, [furnaceCars, furnaceId]);

  // Options converters for Smart Comboboxes
  const shiftOptions: ComboboxOption[] = useMemo(() => {
    return shifts.map((s) => ({
      id: s.id || '',
      code: s.code || 'S01',
      name: s.name,
      subtitle: `${s.startTime || '08:00'} - ${s.endTime || '16:00'} (${s.hours} ${tr.hours})`,
      iconType: 'shift',
      rawItem: s,
    }));
  }, [shifts, tr.hours]);

  const pressOptions: ComboboxOption[] = useMemo(() => {
    return presses.map((p) => ({
      id: p.id || '',
      code: p.code || 'P01',
      name: p.name,
      subtitle: p.tonnage ? `${tr.capacity}: ${p.tonnage} ${tr.ton} | ${p.model || ''}` : p.model,
      extraBadge: p.tonnage ? `${p.tonnage}T` : undefined,
      iconType: 'press',
      rawItem: p,
    }));
  }, [presses, tr.capacity, tr.ton]);

  const furnaceOptions: ComboboxOption[] = useMemo(() => {
    return furnaces.map((f) => ({
      id: f.id || '',
      code: f.code || 'F01',
      name: f.name,
      subtitle: f.maxTemperature ? `${tr.maxTemp}: ${f.maxTemperature}°C | ${tr.capacity}: ${f.capacity || 0} ${tr.ton}` : undefined,
      extraBadge: f.maxTemperature ? `${f.maxTemperature}°C` : undefined,
      iconType: 'furnace',
      rawItem: f,
    }));
  }, [furnaces, tr.maxTemp, tr.capacity, tr.ton]);

  const furnaceCarOptions: ComboboxOption[] = useMemo(() => {
    return availableFurnaceCars.map((c) => ({
      id: c.id || '',
      code: c.code || `CAR-${c.carNumber}`,
      name: `${tr.carNumber} #${c.carNumber || c.code}`,
      subtitle: c.furnaceName ? `${tr.furnaceLabel}: ${c.furnaceName}` : `${tr.capacity}: ${c.capacity || 0} ${tr.ton}`,
      extraBadge: c.carNumber ? `#${c.carNumber}` : undefined,
      iconType: 'car',
      rawItem: c,
    }));
  }, [availableFurnaceCars, tr.carNumber, tr.furnaceLabel, tr.capacity, tr.ton]);

  const employeeOptions: ComboboxOption[] = useMemo(() => {
    return employees.map((e) => ({
      id: e.id || '',
      code: e.code || 'E001',
      name: e.name,
      subtitle: `${tr.department}: ${e.departmentName || tr.productionDept} ${e.jobTitle ? `| ${e.jobTitle}` : ''}`,
      extraBadge: e.departmentName || tr.productionDept,
      iconType: 'employee',
      rawItem: e,
    }));
  }, [employees, tr.department, tr.productionDept]);

  const productOptions: ComboboxOption[] = useMemo(() => {
    return products.map((p) => ({
      id: p.id || '',
      code: p.code || p.productCode || 'PRD-001',
      name: p.name || p.productName || tr.thermalProduct,
      subtitle: `${p.productTypeName || p.category || tr.thermalBrick} | ${p.aluminaPercentage !== undefined && p.aluminaPercentage !== null ? `${tr.alumina}: ${p.aluminaPercentage}%` : tr.manualCode} | ${tr.weight}: ${p.pieceWeight || p.pieceWeightKg || 4.5} ${tr.kg}`,
      extraBadge: p.aluminaPercentage ? `${p.aluminaPercentage}% Al2O3` : (p.smartParseStatus === 'MANUAL_PRODUCT_CODE' ? tr.manual : undefined),
      iconType: 'product',
      rawItem: p,
    }));
  }, [products, tr.thermalProduct, tr.thermalBrick, tr.manualCode, tr.weight, tr.kg, tr.manual]);

  const customerOptions: ComboboxOption[] = useMemo(() => {
    return customers.map((c) => ({
      id: c.id || '',
      code: c.code || 'CUS-001',
      name: c.name || c.company || tr.customer,
      subtitle: c.company && c.name !== c.company ? `${tr.company}: ${c.company} | ${tr.phone}: ${c.phone || ''}` : (c.phone || c.email || ''),
      iconType: 'customer',
      rawItem: c,
    }));
  }, [customers, tr.customer, tr.company, tr.phone]);

  // Selected Object References for display snapshots
  const currentProduct = useMemo(() => products.find((p) => p.id === productId), [products, productId]);
  const currentShift = useMemo(() => shifts.find((s) => s.id === shiftId), [shifts, shiftId]);
  const currentPress = useMemo(() => presses.find((p) => p.id === pressId), [presses, pressId]);
  const currentFurnace = useMemo(() => furnaces.find((f) => f.id === furnaceId), [furnaces, furnaceId]);
  const currentCustomer = useMemo(() => customers.find((c) => c.id === customerId), [customers, customerId]);

  const selectedFurnaceCarIds = useMemo(() => selectedFurnaceCarEntries.map((e) => e.carId), [selectedFurnaceCarEntries]);

  // Focus the new Brick Count input right after a car is selected, so the
  // operator can immediately type the count without an extra click.
  useEffect(() => {
    if (!lastAddedFurnaceCarId) return;
    const el = document.getElementById(`brick-count-input-${lastAddedFurnaceCarId}`);
    el?.focus();
    setLastAddedFurnaceCarId(null);
  }, [lastAddedFurnaceCarId]);

  const handleAddFurnaceCar = (carId: string | null) => {
    if (!carId) return;
    if (selectedFurnaceCarEntries.some((e) => e.carId === carId)) {
      const car = furnaceCars.find((c) => c.id === carId);
      setErrorMessage(`${tr.car} ${car?.carNumber || car?.code || ''} ${tr.carAlreadyAdded}`);
      return;
    }
    setSelectedFurnaceCarEntries((prev) => [...prev, { carId, brickCount: '' }]);
    setLastAddedFurnaceCarId(carId);
    setErrorMessage(null);
  };

  const handleRemoveFurnaceCar = (carId: string) => {
    // Removes the car AND only its own brick count - other selected cars'
    // brick counts are untouched.
    setSelectedFurnaceCarEntries((prev) => prev.filter((e) => e.carId !== carId));
  };

  const handleFurnaceCarBrickCountChange = (carId: string, value: string) => {
    setSelectedFurnaceCarEntries((prev) => prev.map((e) => (e.carId === carId ? { ...e, brickCount: value } : e)));
  };

  const selectedEmployeesList = useMemo(() => {
    return employees.filter((e) => selectedEmployeeIds.includes(e.id || ''));
  }, [employees, selectedEmployeeIds]);

  // Real-time calculation metrics
  const metrics = calculateProductionMetrics(productionQuantity, wasteQuantity, pieceWeight, {
    mechanicalFaults,
    electricalFaults,
    workshopFaults,
    rawMaterialFaults,
    furnaceFaults,
    pressFaults,
    otherFaults,
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setSuccessMessage(null);

    if (!date) {
      setErrorMessage(tr.selectDate);
      return;
    }
    if (!shiftId) {
      setErrorMessage(tr.selectShift);
      return;
    }
    if (!pressId) {
      setErrorMessage(tr.selectPress);
      return;
    }
    if (!productId) {
      setErrorMessage(tr.selectProduct);
      return;
    }
    if (!productionQuantity || productionQuantity <= 0) {
      setErrorMessage(tr.productionQtyPositive);
      return;
    }
    if (!pieceWeight || pieceWeight <= 0) {
      setErrorMessage(tr.selectPieceWeight);
      return;
    }
    // Each selected Furnace Car requires its own Brick Count: a non-negative integer.
    for (const entry of selectedFurnaceCarEntries) {
      const car = furnaceCars.find((c) => c.id === entry.carId);
      const carLabel = car?.carNumber || car?.code || entry.carId;
      const trimmed = entry.brickCount.trim();
      if (trimmed === '') {
        setErrorMessage(`${tr.brickCountRequired} ${carLabel}.`);
        return;
      }
      const brickCountNum = Number(trimmed);
      if (!Number.isInteger(brickCountNum) || brickCountNum < 0) {
        setErrorMessage(`${tr.brickCountForCar} ${carLabel} ${tr.brickCountInteger}`);
        return;
      }
    }

    // Business (non-blocking) WARNINGS - technically valid, logically unusual
    // (§6/§9): these NEVER auto-block the save. Stop here only to show the
    // warning and require an EXPLICIT "Save Despite Warning" (§14), never
    // treating the mere act of clicking Save as approval.
    const totalFaultsMinutes = (mechanicalFaults || 0) + (electricalFaults || 0) + (workshopFaults || 0) + (rawMaterialFaults || 0) + (furnaceFaults || 0) + (pressFaults || 0) + (otherFaults || 0);
    const warnings = evaluateProductionWarnings(
      { productionQuantity, wasteQuantity, calculatedTotalFaults: totalFaultsMinutes, shiftHours: currentShift?.hours },
      language
    );
    if (warnings.length > 0) {
      setPendingWarnings(warnings);
      return;
    }

    await performSave([]);
  };

  /**
   * Actually persists the record - reused by both the no-warning path and
   * the explicit "Save Despite Warning" confirmation. `overriddenWarnings`
   * is only non-empty when the user explicitly confirmed - the record's
   * numeric fields are NEVER altered either way (§18).
   */
  const performSave = async (overriddenWarnings: ValidationResult[]) => {
    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      const newRecordData: any = {
        date,
        // Shift snapshots
        shiftId,
        shiftName: currentShift?.name || tr.mainShift,
        shiftCode: currentShift?.code || '',

        // Press snapshots
        pressId,
        pressName: currentPress?.name || tr.press,
        pressCode: currentPress?.code || '',

        // Product snapshots
        productId,
        productName: currentProduct?.name || currentProduct?.productName || tr.thermalProduct,
        productCode: currentProduct?.code || currentProduct?.productCode || '',
        aluminaPercentage: aluminaPercentage || 0,
        pieceWeight: pieceWeight || 0,

        // Quantities & Calculations
        productionQuantity,
        wasteQuantity: wasteQuantity || 0,
        mechanicalFaults: mechanicalFaults || 0,
        electricalFaults: electricalFaults || 0,
        workshopFaults: workshopFaults || 0,
        rawMaterialFaults: rawMaterialFaults || 0,
        furnaceFaults: furnaceFaults || 0,
        pressFaults: pressFaults || 0,
        otherFaults: otherFaults || 0,
        notes: notes || '',
        // Phase 1 Step 8C-5: only an extrusion is marked; a pressing record keeps its historical shape.
        ...(formingMethod === 'EXTRUSION' ? { formingMethod } : {}),
      };

      // Optional Furnace snapshots
      if (furnaceId && currentFurnace) {
        newRecordData.furnaceId = furnaceId;
        newRecordData.furnaceName = currentFurnace.name;
        newRecordData.furnaceCode = currentFurnace.code;
      }

      // Optional Furnace Cars snapshots - each car keeps its OWN Brick Count,
      // parallel-indexed with furnaceCarIds/furnaceCarNumbers (never stored
      // on the Furnace Car Master Data document itself).
      const resolvedFurnaceCarEntries = selectedFurnaceCarEntries
        .map((entry) => ({ car: furnaceCars.find((c) => c.id === entry.carId), brickCount: parseInt(entry.brickCount.trim(), 10) }))
        .filter((x): x is { car: FurnaceCar; brickCount: number } => !!x.car);
      if (resolvedFurnaceCarEntries.length > 0) {
        newRecordData.furnaceCarIds = resolvedFurnaceCarEntries.map((x) => x.car.id || '').filter(Boolean);
        newRecordData.furnaceCarNumbers = resolvedFurnaceCarEntries.map((x) => x.car.carNumber || x.car.code);
        newRecordData.furnaceCarBrickCounts = resolvedFurnaceCarEntries.map((x) => x.brickCount);
        newRecordData.carCodes = resolvedFurnaceCarEntries.map((x) => x.car.code);
        newRecordData.carCode = resolvedFurnaceCarEntries[0].car.code;
      }

      // Optional Team / Workers snapshots
      if (selectedEmployeesList.length > 0) {
        newRecordData.employeeId = selectedEmployeesList[0].id;
        newRecordData.employeeIds = selectedEmployeesList.map((e) => e.id || '').filter(Boolean);
        newRecordData.employeeNames = selectedEmployeesList.map((e) => e.name);
        newRecordData.employeeCodes = selectedEmployeesList.map((e) => e.code);
        newRecordData.productionEmployees = selectedEmployeesList.map((e) => ({
          id: e.id || '',
          name: e.name,
          code: e.code,
          departmentName: e.departmentName || tr.productionDept,
        }));
      }

      // Optional Product metadata
      if (currentProduct?.productTypePrefix) newRecordData.productTypePrefix = currentProduct.productTypePrefix;
      if (currentProduct?.productTypeName) newRecordData.productTypeName = currentProduct.productTypeName;
      if (currentProduct?.productTypeId) newRecordData.productTypeId = currentProduct.productTypeId;

      // Optional Customer: If selected, write stable ID + name + code
      if (customerId && currentCustomer) {
        newRecordData.customerId = customerId;
        newRecordData.customerName = currentCustomer.name || currentCustomer.company || tr.customer;
        newRecordData.customerCode = currentCustomer.code || '';
      }
      if (customerOrderNumber && customerOrderNumber.trim()) {
        newRecordData.customerOrderNumber = customerOrderNumber.trim();
      }

      // Inputs and outputs (Phase 1 Step 6) are validated and merged BEFORE the existing batched write; invalid lines throw and nothing is written.
      const genealogyInputs = productionGenealogy?.inputs ?? [];
      const genealogy = await prepareProductionGenealogy(genealogyInputs, productionGenealogy?.outputs ?? [], productionReferences, language);
      const consumptionLines = await prepareActualConsumption(genealogyInputs, language);
      if (consumptionLines.length) newRecordData.materials = consumptionLines;
      Object.assign(newRecordData, genealogy);
      // References are validated and merged BEFORE the existing batched write; an invalid traced selection throws and nothing is written.
      const referencedRecordData = await attachProductionReferences('pressing', newRecordData, productionReferences, language);
      const newRecordId = await createProductionRecord(referencedRecordData);

      // The new record's references, as one additive entry in the existing audit log.
      const referencesAudit = describeProductionReferences(newRecordId, referencedRecordData);
      if (referencesAudit) logAuditAction('CREATE', 'production', newRecordId, referencesAudit).catch(() => {});
      // The new record's outputs, likewise (stage records keep them in their audit history's stored data).
      const genealogyAudit = describeOutputChange([], genealogy.productionOutputs ?? []);
      if (genealogyAudit) logAuditAction('CREATE', 'production', newRecordId, genealogyAudit).catch(() => {});

      // Warning Override Audit (§17) - separate, additive entry; only written
      // when the user actually confirmed past a warning. Never logs secrets.
      if (overriddenWarnings.length > 0) {
        logAuditAction(
          'UPDATE',
          'production',
          newRecordId,
          `[OVERRIDE_WARNING] productionRecordId=${newRecordId} warningCodes=${overriddenWarnings.map((w) => w.code).join(',')} override=true - ${overriddenWarnings.map((w) => w.message).join(' | ')}`
        ).catch(() => {});
      }

      setSuccessMessage(tr.savedSuccess);
      setPendingWarnings([]);

      // CRITICAL: Complete form reset after successful save - form starts completely empty
      resetProductionForm(true);

      if (onSuccess) onSuccess();
    } catch (err: any) {
      // Save failure preserves all entered data untouched
      setErrorMessage(err.message || tr.saveError);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div id="production-entry-container" className="space-y-6 max-w-5xl mx-auto" dir={isRtl ? 'rtl' : 'ltr'}>
      {/* Header card with quick actions */}
      <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-xs flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-black text-slate-900 flex items-center gap-2">
            <Factory className="w-5 h-5 text-red-600" />
            <span>{tr.headerTitle}</span>
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            {tr.headerSubtitle}
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            type="button"
            id="btn-new-production-record"
            onClick={() => resetProductionForm(false)}
            className="px-3.5 py-2 text-xs font-bold text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 rounded-xl transition-colors cursor-pointer flex items-center gap-1.5 shadow-2xs"
            title={tr.resetTitle}
          >
            <RotateCcw className="w-3.5 h-3.5 text-slate-500" />
            <span>{tr.newRecordBtn}</span>
          </button>

          <button
            type="button"
            id="btn-view-all-records"
            onClick={() => onNavigate('production-records')}
            className="px-4 py-2 text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors cursor-pointer"
          >
            {tr.viewAllRecords} {isRtl ? <>&larr;</> : <>&rarr;</>}
          </button>
        </div>
      </div>

      {/* Success Notification Banner */}
      {successMessage && (
        <div id="success-banner" className="p-4 bg-emerald-50 border border-emerald-200 rounded-2xl text-xs text-emerald-800 flex items-start gap-3 shadow-xs">
          <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="font-bold text-sm text-emerald-900">{successMessage}</p>
            <p className="text-emerald-700 text-xs mt-0.5">{tr.clearedFullyNote}</p>
            <div className="mt-2.5 flex items-center gap-2">
              <button
                type="button"
                onClick={() => onNavigate('production-records')}
                className="px-3.5 py-1.5 bg-emerald-700 hover:bg-emerald-800 text-white font-bold rounded-lg text-xs transition-colors cursor-pointer"
              >
                {tr.goToRecordsTable}
              </button>
              <button
                type="button"
                onClick={() => {
                  setSuccessMessage(null);
                  resetProductionForm(true);
                }}
                className="px-3.5 py-1.5 bg-white text-emerald-800 border border-emerald-200 font-bold rounded-lg text-xs hover:bg-emerald-50 transition-colors cursor-pointer"
              >
                {tr.recordAnother}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Error Notification Banner */}
      {errorMessage && (
        <div id="error-banner" className="p-4 bg-rose-50 border border-rose-200 rounded-2xl text-xs text-rose-800 flex items-start gap-3 shadow-xs">
          <AlertCircle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="font-bold text-sm text-rose-900">{tr.dataEntryError}</p>
            <p className="mt-1">{errorMessage}</p>
          </div>
        </div>
      )}

      <form id="production-entry-form" onSubmit={handleSubmit} className="space-y-6">
        {/* Section 1: Basic Operation & Equipment Details */}
        <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-xs space-y-5">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <h3 className="text-sm font-black text-slate-900 flex items-center gap-2">
              <Clock className="w-4 h-4 text-red-600" />
              <span>{tr.section1Title}</span>
            </h3>
            <span className="text-[11px] text-slate-400 font-medium">{tr.instantSearch}</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
            {/* Date */}
            <div>
              <label htmlFor="production-date-input" className="block text-xs font-bold text-slate-700 mb-1.5 uppercase tracking-wide">
                {tr.productionDate} <span className="text-red-500">*</span>
              </label>
              <input
                id="production-date-input"
                type="date"
                required
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full bg-white border border-slate-300 rounded-xl px-3.5 py-2.5 text-xs font-semibold text-slate-800 focus:outline-none focus:border-red-500 focus:ring-2 focus:ring-red-500/20"
              />
            </div>

            {/* Smart Shift Selector */}
            <SearchableCombobox
              id="shift-select"
              label={tr.shiftLabel}
              placeholder={tr.chooseByCodeOrName}
              options={shiftOptions}
              value={shiftId}
              onChange={(val) => setShiftId(val || '')}
              required
            />

            {/* Smart Press Selector */}
            <SearchableCombobox
              id="press-select"
              label={tr.pressLabel}
              placeholder={tr.searchByPressCodeOrName}
              options={pressOptions}
              value={pressId}
              onChange={(val) => setPressId(val || '')}
              required
            />

            {/* Forming method (Phase 1 Step 8C-5): extrusion is pressing-stage work on an extruder */}
            <div>
              <label htmlFor="forming-method-select" className="block text-xs font-bold text-slate-700 mb-1.5">
                {language === 'ar' ? 'طريقة التشكيل' : 'Forming method'}
              </label>
              <select
                id="forming-method-select"
                value={formingMethod}
                onChange={(e) => setFormingMethod(e.target.value as FormingMethod)}
                className="w-full px-3.5 py-2.5 text-sm bg-white border border-slate-300 rounded-xl"
              >
                <option value="PRESSING">{language === 'ar' ? 'كبس' : 'Pressing'}</option>
                <option value="EXTRUSION">{language === 'ar' ? 'بثق' : 'Extrusion'}</option>
              </select>
            </div>

            {/* Smart Furnace Selector */}
            <SearchableCombobox
              id="furnace-select"
              label={tr.furnaceOptional}
              placeholder={tr.searchByFurnaceCodeOrName}
              options={furnaceOptions}
              value={furnaceId}
              onChange={(val) => setFurnaceId(val || '')}
            />
          </div>

          {/* Furnace Cars: each selected car gets its OWN Brick Count field */}
          <div className="pt-1 space-y-2">
            <SearchableCombobox
              id="furnace-cars-select"
              label={tr.addFurnaceCar}
              placeholder={tr.searchByCarNumberOrCode}
              options={furnaceCarOptions.filter((o) => !selectedFurnaceCarIds.includes(o.id))}
              value={null}
              onChange={(carId) => handleAddFurnaceCar(carId)}
              helperText={furnaceId ? tr.autoFilteredCars(currentFurnace?.name || currentFurnace?.code || '') : tr.chooseFurnaceToFilter}
            />

            {selectedFurnaceCarEntries.length > 0 && (
              <div className="space-y-2 pt-1">
                {selectedFurnaceCarEntries.map((entry) => {
                  const car = furnaceCars.find((c) => c.id === entry.carId);
                  return (
                    <div key={entry.carId} className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2">
                      <button
                        type="button"
                        onClick={() => handleRemoveFurnaceCar(entry.carId)}
                        className="flex items-center gap-1.5 px-2.5 py-1 bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 rounded-lg text-xs font-bold cursor-pointer shrink-0"
                        title={tr.removeCar}
                      >
                        <span>{tr.carNumber} #{car?.carNumber || car?.code || entry.carId}</span>
                        <span aria-hidden="true">×</span>
                      </button>
                      <label className="text-xs font-bold text-slate-600 shrink-0">{tr.brickCountLabel}</label>
                      <input
                        id={`brick-count-input-${entry.carId}`}
                        type="number"
                        min={0}
                        step={1}
                        value={entry.brickCount}
                        onChange={(e) => handleFurnaceCarBrickCountChange(entry.carId, e.target.value)}
                        onKeyDown={(e) => {
                          // Enter here must never submit the whole production record.
                          if (e.key === 'Enter') {
                            e.preventDefault();
                          }
                        }}
                        placeholder={tr.brickCountExample}
                        className="flex-1 min-w-0 px-2.5 py-1.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-red-500"
                      />
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Section 2: Team Assignment (Multiple Workers Smart Search) */}
        <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-xs space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <h3 className="text-sm font-black text-slate-900 flex items-center gap-2">
              <Users className="w-4 h-4 text-red-600" />
              <span>{tr.section2Title}</span>
            </h3>
            <span className="text-xs font-bold text-red-700 bg-red-50 px-2.5 py-1 rounded-lg border border-red-200">
              {tr.selectedWorkers(selectedEmployeeIds.length)}
            </span>
          </div>

          <MultiSearchableCombobox
            id="employee-team-select"
            label={tr.addWorkers}
            placeholder={tr.searchWorkerPlaceholder}
            options={employeeOptions}
            selectedIds={selectedEmployeeIds}
            onChange={(ids) => setSelectedEmployeeIds(ids)}
            helperText={tr.searchWorkerHelper}
          />
        </div>

        {/* Section 3: Product, Customer & Specifications (Smart Search) */}
        <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-xs space-y-5">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <h3 className="text-sm font-black text-slate-900 flex items-center gap-2">
              <Box className="w-4 h-4 text-red-600" />
              <span>{tr.section3Title}</span>
            </h3>
            {currentProduct && (
              <span className="text-xs font-mono font-bold text-slate-700 bg-slate-100 px-2.5 py-1 rounded-lg border border-slate-200">
                {currentProduct.code} &mdash; {currentProduct.name}
              </span>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
            {/* Smart Product Selector */}
            <div className="md:col-span-2">
              <SearchableCombobox
                id="product-select"
                label={tr.productLabel}
                placeholder={tr.searchProductPlaceholder}
                options={productOptions}
                value={productId}
                onChange={handleProductSelect}
                required
              />
            </div>

            {/* Alumina Percentage */}
            <div>
              <label htmlFor="alumina-input" className="block text-xs font-bold text-slate-700 mb-1.5 uppercase tracking-wide">
                {tr.aluminaLabel}
              </label>
              <div className="relative">
                <input
                  id="alumina-input"
                  type="number"
                  step="0.1"
                  min="0"
                  max="100"
                  value={aluminaPercentage || ''}
                  onChange={(e) => setAluminaPercentage(Number(e.target.value))}
                  placeholder="0"
                  className="w-full bg-white border border-slate-300 rounded-xl px-3.5 py-2.5 text-xs font-bold text-slate-900 focus:outline-none focus:border-red-500 focus:ring-2 focus:ring-red-500/20"
                />
                <span className="absolute left-3 top-2.5 text-xs text-slate-400 font-mono">%</span>
              </div>
            </div>

            {/* Piece Weight in kg */}
            <div>
              <label htmlFor="piece-weight-input" className="block text-xs font-bold text-slate-700 mb-1.5 uppercase tracking-wide">
                {tr.pieceWeightLabel} <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <input
                  id="piece-weight-input"
                  type="number"
                  step="0.01"
                  required
                  min="0.01"
                  placeholder="0.00"
                  value={pieceWeight || ''}
                  onChange={(e) => setPieceWeight(Number(e.target.value) || 0)}
                  className="w-full bg-white border border-slate-300 rounded-xl px-3.5 py-2.5 text-xs font-bold text-slate-900 focus:outline-none focus:border-red-500 focus:ring-2 focus:ring-red-500/20"
                />
                <span className="absolute left-3 top-2.5 text-xs text-slate-400">{tr.kg}</span>
              </div>
            </div>
          </div>

          {/* Customer and Order Number Row */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-1">
            {/* Smart Customer Selector */}
            <div className="sm:col-span-2">
              <SearchableCombobox
                id="customer-select"
                label={tr.customerLabel}
                placeholder={tr.searchCustomerPlaceholder}
                options={customerOptions}
                value={customerId}
                onChange={(val) => setCustomerId(val || '')}
              />
            </div>

            {/* Customer Order Number */}
            <div>
              <label htmlFor="customer-order-number" className="block text-xs font-bold text-slate-700 mb-1.5 uppercase tracking-wide">
                {tr.orderNumberLabel}
              </label>
              <input
                id="customer-order-number"
                type="text"
                value={customerOrderNumber}
                onChange={(e) => setCustomerOrderNumber(e.target.value)}
                placeholder={tr.orderNumberExample}
                className="w-full bg-white border border-slate-300 rounded-xl px-3.5 py-2.5 text-xs font-medium text-slate-800 focus:outline-none focus:border-red-500 focus:ring-2 focus:ring-red-500/20"
              />
            </div>
          </div>

          {/* Selected Identification Summary Box */}
          <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl flex flex-wrap items-center gap-4 text-xs">
            <span className="font-bold text-slate-700 flex items-center gap-1.5">
              <Info className="w-4 h-4 text-slate-500" />
              {tr.directMatchSummary}
            </span>

            {currentShift && (
              <span className="inline-flex items-center gap-1 bg-white px-2.5 py-1 rounded-md border border-slate-200 text-slate-800">
                <span className="font-mono font-bold text-slate-500">{currentShift.code}</span>
                <span>&mdash;</span>
                <span className="font-semibold">{currentShift.name}</span>
              </span>
            )}

            {currentPress && (
              <span className="inline-flex items-center gap-1 bg-white px-2.5 py-1 rounded-md border border-slate-200 text-slate-800">
                <span className="font-mono font-bold text-slate-500">{currentPress.code}</span>
                <span>&mdash;</span>
                <span className="font-semibold">{currentPress.name}</span>
              </span>
            )}

            {currentProduct && (
              <span className="inline-flex items-center gap-1 bg-white px-2.5 py-1 rounded-md border border-slate-200 text-slate-800">
                <span className="font-mono font-bold text-slate-500">{currentProduct.code}</span>
                <span>&mdash;</span>
                <span className="font-semibold">{currentProduct.name}</span>
              </span>
            )}
          </div>
        </div>

        {/* Section 4: Production Quantities & Live Calculations Engine */}
        <div className="bg-slate-900 rounded-2xl p-6 text-white border border-slate-800 shadow-xl space-y-5">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <h3 className="text-sm font-black text-white flex items-center gap-2">
              <Calculator className="w-4 h-4 text-red-400" />
              <span>{tr.section4Title}</span>
            </h3>
            <span className="text-xs text-red-400 font-bold bg-red-500/10 px-2.5 py-1 rounded-md border border-red-500/20">
              {tr.preciseFormulas}
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            {/* Input Total Quantity */}
            <div className="bg-slate-800/80 p-4 rounded-xl border border-slate-700">
              <label htmlFor="production-quantity-input" className="block text-xs font-bold text-slate-300 mb-1.5 uppercase tracking-wide">
                {tr.totalProductionQty} <span className="text-red-400">*</span>
              </label>
              <input
                id="production-quantity-input"
                type="number"
                required
                min="1"
                placeholder="0"
                value={productionQuantity || ''}
                onChange={(e) => setProductionQuantity(Number(e.target.value) || 0)}
                className="w-full bg-slate-900 border border-slate-600 rounded-xl px-4 py-2.5 text-lg font-black text-white focus:outline-none focus:border-red-400"
              />
            </div>

            {/* Input Waste Quantity */}
            <div className="bg-slate-800/80 p-4 rounded-xl border border-slate-700">
              <label htmlFor="waste-quantity-input" className="block text-xs font-bold text-slate-300 mb-1.5 uppercase tracking-wide">
                {tr.wasteQtyLabel} <span className="text-rose-400">*</span>
              </label>
              <input
                id="waste-quantity-input"
                type="number"
                required
                min="0"
                placeholder="0"
                value={wasteQuantity === 0 ? '' : wasteQuantity}
                onChange={(e) => setWasteQuantity(Number(e.target.value) || 0)}
                className="w-full bg-slate-900 border border-slate-600 rounded-xl px-4 py-2.5 text-lg font-black text-rose-400 focus:outline-none focus:border-rose-400"
              />
            </div>
          </div>

          {/* Reactive Calculation Display Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2">
            <div id="metric-good-quantity" className="bg-slate-800/60 p-3.5 rounded-xl border border-slate-700 text-center">
              <span className="text-[11px] text-slate-400 block mb-1">{tr.goodProductionPcs}</span>
              <span className="text-xl font-black text-emerald-400">
                {formatNumber(metrics.goodQuantity)}
              </span>
            </div>

            <div id="metric-waste-percentage" className="bg-slate-800/60 p-3.5 rounded-xl border border-slate-700 text-center">
              <span className="text-[11px] text-slate-400 block mb-1">{tr.wastePercentLabel}</span>
              <span className={`text-xl font-black ${metrics.wastePercentage > 5 ? 'text-rose-400' : 'text-amber-400'}`}>
                {formatDecimal(metrics.wastePercentage, 2)}%
              </span>
            </div>

            <div id="metric-total-weight" className="bg-slate-800/60 p-3.5 rounded-xl border border-slate-700 text-center">
              <span className="text-[11px] text-slate-400 block mb-1">{tr.totalWeightLabel}</span>
              <span className="text-base font-black text-white block">
                {formatNumber(metrics.productionWeight)} {tr.kg}
              </span>
              <span className="text-[10px] text-slate-400 font-mono">
                ({formatDecimal(metrics.productionWeight / 1000, 2)} {tr.ton})
              </span>
            </div>

            <div id="metric-good-weight" className="bg-slate-800/60 p-3.5 rounded-xl border border-slate-700 text-center">
              <span className="text-[11px] text-slate-400 block mb-1">{tr.goodNetWeightLabel}</span>
              <span className="text-base font-black text-emerald-400 block">
                {formatNumber(metrics.goodWeight)} {tr.kg}
              </span>
              <span className="text-[10px] text-slate-400 font-mono">
                ({formatDecimal(metrics.goodWeight / 1000, 2)} {tr.ton})
              </span>
            </div>
          </div>
        </div>

        {/* Section 5: Faults & Downtime Breakdown */}
        <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-xs space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <h3 className="text-sm font-black text-slate-900 flex items-center gap-2">
              <Wrench className="w-4 h-4 text-red-600" />
              <span>{tr.section5Title}</span>
            </h3>
            <span className="text-xs font-bold text-slate-700 bg-slate-100 px-3 py-1 rounded-lg border border-slate-200">
              {tr.totalDowntime(metrics.totalDowntimeMinutes, metrics.totalDowntimeHours)}
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-7 gap-3">
            <div>
              <label htmlFor="fault-mechanical" className="block text-[11px] font-bold text-slate-600 mb-1">{tr.faultMechanical}</label>
              <input
                id="fault-mechanical"
                type="number"
                min="0"
                value={mechanicalFaults || ''}
                onChange={(e) => setMechanicalFaults(Number(e.target.value))}
                placeholder="0"
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-1.5 text-xs text-center font-bold text-slate-800 focus:outline-none focus:border-red-500"
              />
            </div>
            <div>
              <label htmlFor="fault-electrical" className="block text-[11px] font-bold text-slate-600 mb-1">{tr.faultElectrical}</label>
              <input
                id="fault-electrical"
                type="number"
                min="0"
                value={electricalFaults || ''}
                onChange={(e) => setElectricalFaults(Number(e.target.value))}
                placeholder="0"
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-1.5 text-xs text-center font-bold text-slate-800 focus:outline-none focus:border-red-500"
              />
            </div>
            <div>
              <label htmlFor="fault-workshop" className="block text-[11px] font-bold text-slate-600 mb-1">{tr.faultWorkshop}</label>
              <input
                id="fault-workshop"
                type="number"
                min="0"
                value={workshopFaults || ''}
                onChange={(e) => setWorkshopFaults(Number(e.target.value))}
                placeholder="0"
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-1.5 text-xs text-center font-bold text-slate-800 focus:outline-none focus:border-red-500"
              />
            </div>
            <div>
              <label htmlFor="fault-raw-material" className="block text-[11px] font-bold text-slate-600 mb-1">{tr.faultRawMaterial}</label>
              <input
                id="fault-raw-material"
                type="number"
                min="0"
                value={rawMaterialFaults || ''}
                onChange={(e) => setRawMaterialFaults(Number(e.target.value))}
                placeholder="0"
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-1.5 text-xs text-center font-bold text-slate-800 focus:outline-none focus:border-red-500"
              />
            </div>
            <div>
              <label htmlFor="fault-furnace" className="block text-[11px] font-bold text-slate-600 mb-1">{tr.faultFurnace}</label>
              <input
                id="fault-furnace"
                type="number"
                min="0"
                value={furnaceFaults || ''}
                onChange={(e) => setFurnaceFaults(Number(e.target.value))}
                placeholder="0"
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-1.5 text-xs text-center font-bold text-slate-800 focus:outline-none focus:border-red-500"
              />
            </div>
            <div>
              <label htmlFor="fault-press" className="block text-[11px] font-bold text-slate-600 mb-1">{tr.faultPress}</label>
              <input
                id="fault-press"
                type="number"
                min="0"
                value={pressFaults || ''}
                onChange={(e) => setPressFaults(Number(e.target.value))}
                placeholder="0"
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-1.5 text-xs text-center font-bold text-slate-800 focus:outline-none focus:border-red-500"
              />
            </div>
            <div>
              <label htmlFor="fault-other" className="block text-[11px] font-bold text-slate-600 mb-1">{tr.faultOther}</label>
              <input
                id="fault-other"
                type="number"
                min="0"
                value={otherFaults || ''}
                onChange={(e) => setOtherFaults(Number(e.target.value))}
                placeholder="0"
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-1.5 text-xs text-center font-bold text-slate-800 focus:outline-none focus:border-red-500"
              />
            </div>
          </div>

          <div className="pt-2">
            <label htmlFor="production-notes-input" className="block text-xs font-bold text-slate-700 mb-1.5">
              {tr.notesLabel}
            </label>
            <input
              id="production-notes-input"
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={tr.notesPlaceholder}
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2 text-xs font-medium text-slate-800 focus:outline-none focus:border-red-500"
            />
          </div>
        </div>

        {/* Submit Actions Button */}
        <div className="flex items-center justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={() => onNavigate('dashboard')}
            className="px-5 py-2.5 text-xs font-bold text-slate-600 bg-white hover:bg-slate-50 border border-slate-200 rounded-xl transition-colors cursor-pointer"
          >
            {tr.cancel}
          </button>
          <button
            id="btn-submit-production"
            type="submit"
            disabled={isSubmitting || isLoadingData}
            className="px-7 py-2.5 text-xs font-black text-white bg-red-600 hover:bg-red-700 active:scale-98 rounded-xl shadow-md transition-all cursor-pointer flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSubmitting ? (
              <>
                <RotateCcw className="w-4 h-4 animate-spin" />
                <span>{tr.savingCloud}</span>
              </>
            ) : (
              <>
                <CheckCircle2 className="w-4 h-4" />
                <span>{tr.saveAndMatch}</span>
              </>
            )}
          </button>
        </div>
      </form>

      {/* Business Warning - Edit Data vs Save Despite Warning (§3/§7/§14) */}
      {pendingWarnings.length > 0 && (
        <Modal
          isOpen={true}
          onClose={() => setPendingWarnings([])}
          title={tr.warningsTitle(pendingWarnings.length)}
          maxWidth="md"
        >
          <div className="space-y-3">
            <div className="p-3 bg-amber-50 border-2 border-amber-300 rounded-xl">
              <ul className="list-disc pr-5 text-sm font-bold text-amber-900 space-y-1">
                {pendingWarnings.map((w, idx) => <li key={idx}>{w.message}</li>)}
              </ul>
              <p className="text-[11px] text-amber-700 mt-2">{tr.stillValidNote}</p>
            </div>
            {!canOverrideWarnings && (
              <p className="text-[11px] text-red-600 font-bold bg-red-50 border border-red-200 rounded-lg p-2">
                {tr.noOverridePermission}
              </p>
            )}
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setPendingWarnings([])}
                className="px-4 py-2 text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer"
              >
                {tr.editData}
              </button>
              <button
                type="button"
                disabled={!canOverrideWarnings || isSubmitting}
                onClick={() => performSave(pendingWarnings)}
                className="px-4 py-2 text-xs font-black text-white bg-amber-600 hover:bg-amber-700 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg cursor-pointer"
              >
                {tr.saveDespiteWarning}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};

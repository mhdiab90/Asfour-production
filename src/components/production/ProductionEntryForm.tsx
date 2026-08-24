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
  NavigationPage 
} from '../../types';
import { fetchMasterData } from '../../services/masterDataService';
import { createProductionRecord, calculateProductionMetrics } from '../../services/productionService';
import { formatNumber, formatDecimal } from '../../utils/formatters';
import { SearchableCombobox, MultiSearchableCombobox, ComboboxOption } from '../common/SearchableCombobox';

interface ProductionEntryFormProps {
  onNavigate: (page: NavigationPage) => void;
  onSuccess?: () => void;
}

export const ProductionEntryForm: React.FC<ProductionEntryFormProps> = ({ onNavigate, onSuccess }) => {
  // Master data state
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [presses, setPresses] = useState<Press[]>([]);
  const [furnaces, setFurnaces] = useState<Furnace[]>([]);
  const [furnaceCars, setFurnaceCars] = useState<FurnaceCar[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [isLoadingData, setIsLoadingData] = useState<boolean>(true);

  // Form selections & values
  const [date, setDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [shiftId, setShiftId] = useState<string>('');
  const [pressId, setPressId] = useState<string>('');
  const [furnaceId, setFurnaceId] = useState<string>('');
  const [selectedCarIds, setSelectedCarIds] = useState<string[]>([]);
  const [selectedEmployeeIds, setSelectedEmployeeIds] = useState<string[]>([]);
  const [customerId, setCustomerId] = useState<string>('');
  const [customerOrderNumber, setCustomerOrderNumber] = useState<string>('');
  const [productId, setProductId] = useState<string>('');
  const [aluminaPercentage, setAluminaPercentage] = useState<number>(0);
  const [pieceWeight, setPieceWeight] = useState<number>(4.5);

  // Quantities
  const [productionQuantity, setProductionQuantity] = useState<number>(500);
  const [wasteQuantity, setWasteQuantity] = useState<number>(15);

  // Faults / Downtime in minutes
  const [mechanicalFaults, setMechanicalFaults] = useState<number>(0);
  const [electricalFaults, setElectricalFaults] = useState<number>(0);
  const [workshopFaults, setWorkshopFaults] = useState<number>(0);
  const [rawMaterialFaults, setRawMaterialFaults] = useState<number>(0);
  const [furnaceFaults, setFurnaceFaults] = useState<number>(0);
  const [pressFaults, setPressFaults] = useState<number>(0);
  const [otherFaults, setOtherFaults] = useState<number>(0);

  const [notes, setNotes] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Load active master data on mount
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

        // Initial default selections if empty
        if (activeShifts.length > 0 && !shiftId) setShiftId(activeShifts[0].id || '');
        if (activePresses.length > 0 && !pressId) setPressId(activePresses[0].id || '');
        if (activeProducts.length > 0 && !productId) {
          const firstProd = activeProducts[0];
          setProductId(firstProd.id || '');
          setAluminaPercentage(firstProd.aluminaPercentage ?? 0);
          setPieceWeight(firstProd.pieceWeight || firstProd.pieceWeightKg || 4.5);
        }
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
          setPieceWeight(prod.pieceWeight || prod.pieceWeightKg || 4.5);
        }
      }
    } else {
      setAluminaPercentage(0);
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
      subtitle: `${s.startTime || '08:00'} - ${s.endTime || '16:00'} (${s.hours} ساعات)`,
      iconType: 'shift',
      rawItem: s,
    }));
  }, [shifts]);

  const pressOptions: ComboboxOption[] = useMemo(() => {
    return presses.map((p) => ({
      id: p.id || '',
      code: p.code || 'P01',
      name: p.name,
      subtitle: p.tonnage ? `سعة: ${p.tonnage} طن | ${p.model || ''}` : p.model,
      extraBadge: p.tonnage ? `${p.tonnage}T` : undefined,
      iconType: 'press',
      rawItem: p,
    }));
  }, [presses]);

  const furnaceOptions: ComboboxOption[] = useMemo(() => {
    return furnaces.map((f) => ({
      id: f.id || '',
      code: f.code || 'F01',
      name: f.name,
      subtitle: f.maxTemperature ? `حرارة قصوى: ${f.maxTemperature}°C | سعة: ${f.capacity || 0} طن` : undefined,
      extraBadge: f.maxTemperature ? `${f.maxTemperature}°C` : undefined,
      iconType: 'furnace',
      rawItem: f,
    }));
  }, [furnaces]);

  const furnaceCarOptions: ComboboxOption[] = useMemo(() => {
    return availableFurnaceCars.map((c) => ({
      id: c.id || '',
      code: c.code || `CAR-${c.carNumber}`,
      name: `عربة رقم #${c.carNumber || c.code}`,
      subtitle: c.furnaceName ? `الفرن: ${c.furnaceName}` : `سعة: ${c.capacity || 0} طن`,
      extraBadge: c.carNumber ? `#${c.carNumber}` : undefined,
      iconType: 'car',
      rawItem: c,
    }));
  }, [availableFurnaceCars]);

  const employeeOptions: ComboboxOption[] = useMemo(() => {
    return employees.map((e) => ({
      id: e.id || '',
      code: e.code || 'E001',
      name: e.name,
      subtitle: `القسم: ${e.departmentName || 'الإنتاج'} ${e.jobTitle ? `| ${e.jobTitle}` : ''}`,
      extraBadge: e.departmentName || 'الإنتاج',
      iconType: 'employee',
      rawItem: e,
    }));
  }, [employees]);

  const productOptions: ComboboxOption[] = useMemo(() => {
    return products.map((p) => ({
      id: p.id || '',
      code: p.code || p.productCode || 'PRD-001',
      name: p.name || p.productName || 'منتج حراري',
      subtitle: `${p.productTypeName || p.category || 'طوب حراري'} | ${p.aluminaPercentage !== undefined && p.aluminaPercentage !== null ? `ألومينا: ${p.aluminaPercentage}%` : 'كود يدوي'} | وزن: ${p.pieceWeight || p.pieceWeightKg || 4.5} كجم`,
      extraBadge: p.aluminaPercentage ? `${p.aluminaPercentage}% Al2O3` : (p.smartParseStatus === 'MANUAL_PRODUCT_CODE' ? 'يدوي' : undefined),
      iconType: 'product',
      rawItem: p,
    }));
  }, [products]);

  const customerOptions: ComboboxOption[] = useMemo(() => {
    return customers.map((c) => ({
      id: c.id || '',
      code: c.code || 'CUS-001',
      name: c.name || c.company || 'عميل',
      subtitle: c.company && c.name !== c.company ? `شركة: ${c.company} | هاتف: ${c.phone || ''}` : (c.phone || c.email || ''),
      iconType: 'customer',
      rawItem: c,
    }));
  }, [customers]);

  // Selected Object References for display snapshots
  const currentProduct = useMemo(() => products.find((p) => p.id === productId), [products, productId]);
  const currentShift = useMemo(() => shifts.find((s) => s.id === shiftId), [shifts, shiftId]);
  const currentPress = useMemo(() => presses.find((p) => p.id === pressId), [presses, pressId]);
  const currentFurnace = useMemo(() => furnaces.find((f) => f.id === furnaceId), [furnaces, furnaceId]);
  const currentCustomer = useMemo(() => customers.find((c) => c.id === customerId), [customers, customerId]);

  const selectedCarsList = useMemo(() => {
    return furnaceCars.filter((c) => selectedCarIds.includes(c.id || ''));
  }, [furnaceCars, selectedCarIds]);

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
      setErrorMessage('يرجى تحديد تاريخ عملية الإنتاج.');
      return;
    }
    if (!shiftId) {
      setErrorMessage('يرجى اختيار وردية العمل.');
      return;
    }
    if (!pressId) {
      setErrorMessage('يرجى اختيار المكبس.');
      return;
    }
    if (!productId) {
      setErrorMessage('يرجى اختيار المنتج الحراري.');
      return;
    }
    if (productionQuantity <= 0) {
      setErrorMessage('إجمالي كمية الإنتاج يجب أن تكون أكبر من الصفر.');
      return;
    }
    if (wasteQuantity > productionQuantity) {
      setErrorMessage('كمية الهالك / التالف لا يمكن أن تتجاوز إجمالي كمية الإنتاج.');
      return;
    }

    setIsSubmitting(true);

    try {
      const newRecordData: any = {
        date,
        // Shift snapshots
        shiftId,
        shiftName: currentShift?.name || 'وردية رئيسية',
        shiftCode: currentShift?.code || '',

        // Press snapshots
        pressId,
        pressName: currentPress?.name || 'مكبس',
        pressCode: currentPress?.code || '',

        // Product snapshots
        productId,
        productName: currentProduct?.name || currentProduct?.productName || 'منتج حراري',
        productCode: currentProduct?.code || currentProduct?.productCode || '',
        aluminaPercentage: aluminaPercentage || 0,
        pieceWeight: pieceWeight || 0,

        // Quantities & Calculations
        productionQuantity,
        wasteQuantity,
        mechanicalFaults: mechanicalFaults || 0,
        electricalFaults: electricalFaults || 0,
        workshopFaults: workshopFaults || 0,
        rawMaterialFaults: rawMaterialFaults || 0,
        furnaceFaults: furnaceFaults || 0,
        pressFaults: pressFaults || 0,
        otherFaults: otherFaults || 0,
        notes: notes || '',
      };

      // Optional Furnace snapshots
      if (furnaceId && currentFurnace) {
        newRecordData.furnaceId = furnaceId;
        newRecordData.furnaceName = currentFurnace.name;
        newRecordData.furnaceCode = currentFurnace.code;
      }

      // Optional Furnace Cars snapshots
      if (selectedCarsList.length > 0) {
        newRecordData.furnaceCarIds = selectedCarsList.map((c) => c.id || '').filter(Boolean);
        newRecordData.furnaceCarNumbers = selectedCarsList.map((c) => c.carNumber || c.code);
        newRecordData.carCodes = selectedCarsList.map((c) => c.code);
        newRecordData.carCode = selectedCarsList[0].code;
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
          departmentName: e.departmentName || 'الإنتاج',
        }));
      }

      // Optional Product metadata
      if (currentProduct?.productTypePrefix) newRecordData.productTypePrefix = currentProduct.productTypePrefix;
      if (currentProduct?.productTypeName) newRecordData.productTypeName = currentProduct.productTypeName;
      if (currentProduct?.productTypeId) newRecordData.productTypeId = currentProduct.productTypeId;

      // Optional Customer: If selected, write stable ID + name + code; If not selected, OMIT COMPLETELY
      if (customerId && currentCustomer) {
        newRecordData.customerId = customerId;
        newRecordData.customerName = currentCustomer.name || currentCustomer.company || 'عميل';
        newRecordData.customerCode = currentCustomer.code || '';
      }
      if (customerOrderNumber && customerOrderNumber.trim()) {
        newRecordData.customerOrderNumber = customerOrderNumber.trim();
      }

      await createProductionRecord(newRecordData);

      setSuccessMessage('تم تسجيل وحفظ عملية الإنتاج بنجاح في قاعدة بيانات Firestore السحابية!');
      
      // Reset dynamic inputs for next entry
      setWasteQuantity(0);
      setMechanicalFaults(0);
      setElectricalFaults(0);
      setWorkshopFaults(0);
      setRawMaterialFaults(0);
      setFurnaceFaults(0);
      setPressFaults(0);
      setOtherFaults(0);
      setNotes('');

      if (onSuccess) onSuccess();
    } catch (err: any) {
      setErrorMessage(err.message || 'حدث خطأ أثناء حفظ سجل الإنتاج.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div id="production-entry-container" className="space-y-6 max-w-5xl mx-auto">
      {/* Header card with quick actions */}
      <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-xs flex items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-black text-slate-900 flex items-center gap-2">
            <Factory className="w-5 h-5 text-red-600" />
            <span>تسجيل ومطابقة عمليات الإنتاج اليومية</span>
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            البحث الذكي الموحد بالكود أو بالاسم مع احتساب فوري للهالك والأوزان الصافية ومزامنة Firestore
          </p>
        </div>

        <button
          type="button"
          id="btn-view-all-records"
          onClick={() => onNavigate('production-records')}
          className="px-4 py-2 text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors cursor-pointer"
        >
          عرض كافة السجلات &larr;
        </button>
      </div>

      {/* Success Notification Banner */}
      {successMessage && (
        <div id="success-banner" className="p-4 bg-emerald-50 border border-emerald-200 rounded-2xl text-xs text-emerald-800 flex items-start gap-3 shadow-xs">
          <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="font-bold text-sm text-emerald-900">{successMessage}</p>
            <div className="mt-2 flex items-center gap-2">
              <button
                type="button"
                onClick={() => onNavigate('production-records')}
                className="px-3.5 py-1.5 bg-emerald-700 hover:bg-emerald-800 text-white font-bold rounded-lg text-xs transition-colors"
              >
                انتقال إلى جدول السجلات
              </button>
              <button
                type="button"
                onClick={() => setSuccessMessage(null)}
                className="px-3.5 py-1.5 bg-white text-emerald-800 border border-emerald-200 font-bold rounded-lg text-xs hover:bg-emerald-50 transition-colors"
              >
                تسجيل تشغيلة أخرى
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
            <p className="font-bold text-sm text-rose-900">خطأ في إدخال البيانات</p>
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
              <span>1. الوردية والمعدات والتجهيزات (البحث الذكي بالكود أو الاسم)</span>
            </h3>
            <span className="text-[11px] text-slate-400 font-medium">بحث فوري فائق السرعة</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
            {/* Date */}
            <div>
              <label htmlFor="production-date-input" className="block text-xs font-bold text-slate-700 mb-1.5 uppercase tracking-wide">
                تاريخ الإنتاج <span className="text-red-500">*</span>
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
              label="الوردية"
              placeholder="اختر بالكود أو الاسم..."
              options={shiftOptions}
              value={shiftId}
              onChange={(val) => setShiftId(val || '')}
              required
            />

            {/* Smart Press Selector */}
            <SearchableCombobox
              id="press-select"
              label="المكبس"
              placeholder="ابحث بكود أو اسم المكبس..."
              options={pressOptions}
              value={pressId}
              onChange={(val) => setPressId(val || '')}
              required
            />

            {/* Smart Furnace Selector */}
            <SearchableCombobox
              id="furnace-select"
              label="الفرن (اختياري)"
              placeholder="ابحث بكود أو اسم الفرن..."
              options={furnaceOptions}
              value={furnaceId}
              onChange={(val) => setFurnaceId(val || '')}
            />
          </div>

          {/* Furnace Cars Smart Multi-Select */}
          <div className="pt-1">
            <MultiSearchableCombobox
              id="furnace-cars-select"
              label="عربات الفرن المخصصة للتشغيلة (متعدد):"
              placeholder="ابحث برقم العربة أو الكود لإضافتها..."
              options={furnaceCarOptions}
              selectedIds={selectedCarIds}
              onChange={(ids) => setSelectedCarIds(ids)}
              helperText={furnaceId ? `تم تصفية العربات المتاحة تلقائياً للفرن المختار (${currentFurnace?.name || currentFurnace?.code})` : 'اختر الفرن لتصفية العربات، أو أضف أي عربة متاحة'}
            />
          </div>
        </div>

        {/* Section 2: Team Assignment (Multiple Workers Smart Search) */}
        <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-xs space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <h3 className="text-sm font-black text-slate-900 flex items-center gap-2">
              <Users className="w-4 h-4 text-red-600" />
              <span>2. فريق العمل والقائمون بالتشغيل (بحث بالكود أو الاسم)</span>
            </h3>
            <span className="text-xs font-bold text-red-700 bg-red-50 px-2.5 py-1 rounded-lg border border-red-200">
              تم تحديد ({selectedEmployeeIds.length}) عامل
            </span>
          </div>

          <MultiSearchableCombobox
            id="employee-team-select"
            label="إضافة عمال التشغيل:"
            placeholder="ابحث بكود العامل (مثال E001) أو باسمه (مثال أحمد علي)..."
            options={employeeOptions}
            selectedIds={selectedEmployeeIds}
            onChange={(ids) => setSelectedEmployeeIds(ids)}
            helperText="يمكنك البحث عن أي عامل بكوده أو اسمه وإضافته بضغطة زر، وتظهر بطاقات العمال متضمنة الكود والاسم والقسم."
          />
        </div>

        {/* Section 3: Product, Customer & Specifications (Smart Search) */}
        <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-xs space-y-5">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <h3 className="text-sm font-black text-slate-900 flex items-center gap-2">
              <Box className="w-4 h-4 text-red-600" />
              <span>3. المنتج الحراري، العميل، والمواصفات الفنية</span>
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
                label="المنتج الحراري"
                placeholder="ابحث بكود المنتج (مثال BAR250102305) أو بالاسم..."
                options={productOptions}
                value={productId}
                onChange={handleProductSelect}
                required
              />
            </div>

            {/* Alumina Percentage */}
            <div>
              <label htmlFor="alumina-input" className="block text-xs font-bold text-slate-700 mb-1.5 uppercase tracking-wide">
                نسبة الألومينا (%)
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
                وزن القطعة (كجم) <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <input
                  id="piece-weight-input"
                  type="number"
                  step="0.01"
                  required
                  min="0.01"
                  value={pieceWeight}
                  onChange={(e) => setPieceWeight(Number(e.target.value))}
                  className="w-full bg-white border border-slate-300 rounded-xl px-3.5 py-2.5 text-xs font-bold text-slate-900 focus:outline-none focus:border-red-500 focus:ring-2 focus:ring-red-500/20"
                />
                <span className="absolute left-3 top-2.5 text-xs text-slate-400">كجم</span>
              </div>
            </div>
          </div>

          {/* Customer and Order Number Row */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-1">
            {/* Smart Customer Selector */}
            <div className="sm:col-span-2">
              <SearchableCombobox
                id="customer-select"
                label="العميل / الشركة (اختياري)"
                placeholder="ابحث بكود العميل أو اسم الشركة..."
                options={customerOptions}
                value={customerId}
                onChange={(val) => setCustomerId(val || '')}
              />
            </div>

            {/* Customer Order Number */}
            <div>
              <label htmlFor="customer-order-number" className="block text-xs font-bold text-slate-700 mb-1.5 uppercase tracking-wide">
                رقم أمر التشغيل / التوريد
              </label>
              <input
                id="customer-order-number"
                type="text"
                value={customerOrderNumber}
                onChange={(e) => setCustomerOrderNumber(e.target.value)}
                placeholder="مثال: ORD-2026-8801"
                className="w-full bg-white border border-slate-300 rounded-xl px-3.5 py-2.5 text-xs font-medium text-slate-800 focus:outline-none focus:border-red-500 focus:ring-2 focus:ring-red-500/20"
              />
            </div>
          </div>

          {/* Selected Identification Summary Box */}
          <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl flex flex-wrap items-center gap-4 text-xs">
            <span className="font-bold text-slate-700 flex items-center gap-1.5">
              <Info className="w-4 h-4 text-slate-500" />
              المطابقة المباشرة للتشغيلة:
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
              <span>4. كميات الإنتاج والحسابات الهندسية التلقائية</span>
            </h3>
            <span className="text-xs text-red-400 font-bold bg-red-500/10 px-2.5 py-1 rounded-md border border-red-500/20">
              معادلات فورية دقيقة
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            {/* Input Total Quantity */}
            <div className="bg-slate-800/80 p-4 rounded-xl border border-slate-700">
              <label htmlFor="production-quantity-input" className="block text-xs font-bold text-slate-300 mb-1.5 uppercase tracking-wide">
                إجمالي كمية الإنتاج المكبوسة (قطع) <span className="text-red-400">*</span>
              </label>
              <input
                id="production-quantity-input"
                type="number"
                required
                min="1"
                value={productionQuantity}
                onChange={(e) => setProductionQuantity(Number(e.target.value))}
                className="w-full bg-slate-900 border border-slate-600 rounded-xl px-4 py-2.5 text-lg font-black text-white focus:outline-none focus:border-red-400"
              />
            </div>

            {/* Input Waste Quantity */}
            <div className="bg-slate-800/80 p-4 rounded-xl border border-slate-700">
              <label htmlFor="waste-quantity-input" className="block text-xs font-bold text-slate-300 mb-1.5 uppercase tracking-wide">
                كمية الهالك والتالف (قطع) <span className="text-rose-400">*</span>
              </label>
              <input
                id="waste-quantity-input"
                type="number"
                required
                min="0"
                value={wasteQuantity}
                onChange={(e) => setWasteQuantity(Number(e.target.value))}
                className="w-full bg-slate-900 border border-slate-600 rounded-xl px-4 py-2.5 text-lg font-black text-rose-400 focus:outline-none focus:border-rose-400"
              />
            </div>
          </div>

          {/* Reactive Calculation Display Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2">
            <div id="metric-good-quantity" className="bg-slate-800/60 p-3.5 rounded-xl border border-slate-700 text-center">
              <span className="text-[11px] text-slate-400 block mb-1">الإنتاج السليم (قطع)</span>
              <span className="text-xl font-black text-emerald-400">
                {formatNumber(metrics.goodQuantity)}
              </span>
            </div>

            <div id="metric-waste-percentage" className="bg-slate-800/60 p-3.5 rounded-xl border border-slate-700 text-center">
              <span className="text-[11px] text-slate-400 block mb-1">نسبة الهالك (%)</span>
              <span className={`text-xl font-black ${metrics.wastePercentage > 5 ? 'text-rose-400' : 'text-amber-400'}`}>
                {formatDecimal(metrics.wastePercentage, 2)}%
              </span>
            </div>

            <div id="metric-total-weight" className="bg-slate-800/60 p-3.5 rounded-xl border border-slate-700 text-center">
              <span className="text-[11px] text-slate-400 block mb-1">إجمالي الوزن (كجم / طن)</span>
              <span className="text-base font-black text-white block">
                {formatNumber(metrics.productionWeight)} كجم
              </span>
              <span className="text-[10px] text-slate-400 font-mono">
                ({formatDecimal(metrics.productionWeight / 1000, 2)} طن)
              </span>
            </div>

            <div id="metric-good-weight" className="bg-slate-800/60 p-3.5 rounded-xl border border-slate-700 text-center">
              <span className="text-[11px] text-slate-400 block mb-1">الوزن السليم الصافي</span>
              <span className="text-base font-black text-emerald-400 block">
                {formatNumber(metrics.goodWeight)} كجم
              </span>
              <span className="text-[10px] text-slate-400 font-mono">
                ({formatDecimal(metrics.goodWeight / 1000, 2)} طن)
              </span>
            </div>
          </div>
        </div>

        {/* Section 5: Faults & Downtime Breakdown */}
        <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-xs space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <h3 className="text-sm font-black text-slate-900 flex items-center gap-2">
              <Wrench className="w-4 h-4 text-red-600" />
              <span>5. فئات الأعطال والتوقفات (بالدقائق)</span>
            </h3>
            <span className="text-xs font-bold text-slate-700 bg-slate-100 px-3 py-1 rounded-lg border border-slate-200">
              إجمالي التوقف: {metrics.totalDowntimeMinutes} دقيقة ({metrics.totalDowntimeHours} ساعة)
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-7 gap-3">
            <div>
              <label htmlFor="fault-mechanical" className="block text-[11px] font-bold text-slate-600 mb-1">ميكانيكية</label>
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
              <label htmlFor="fault-electrical" className="block text-[11px] font-bold text-slate-600 mb-1">كهربائية</label>
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
              <label htmlFor="fault-workshop" className="block text-[11px] font-bold text-slate-600 mb-1">ورشة</label>
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
              <label htmlFor="fault-raw-material" className="block text-[11px] font-bold text-slate-600 mb-1">خامات</label>
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
              <label htmlFor="fault-furnace" className="block text-[11px] font-bold text-slate-600 mb-1">فرن</label>
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
              <label htmlFor="fault-press" className="block text-[11px] font-bold text-slate-600 mb-1">مكبس</label>
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
              <label htmlFor="fault-other" className="block text-[11px] font-bold text-slate-600 mb-1">أخرى</label>
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
              ملاحظات التشغيل والتوقفات
            </label>
            <input
              id="production-notes-input"
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="أي تفاصيل إضافية حول أسباب التوقف أو جودة خلطة الحراريات..."
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
            إلغاء
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
                <span>جاري الحفظ والمزامنة السحابية...</span>
              </>
            ) : (
              <>
                <CheckCircle2 className="w-4 h-4" />
                <span>حفظ ومطابقة سجل الإنتاج</span>
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
};

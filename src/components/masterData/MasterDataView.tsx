/**
 * Master Data Management View
 * Manages Master Data entities:
 * Products, Product Types (Prefixes), Employees, Departments, Presses, Furnaces, Furnace Cars, Customers, Shifts
 */
import React, { useState, useEffect, useMemo } from 'react';
import { 
  Users, 
  Building2, 
  Cpu, 
  Flame, 
  Truck, 
  Box, 
  Building, 
  Clock, 
  Plus, 
  Search, 
  Filter, 
  Edit, 
  Trash2, 
  CheckCircle2, 
  XCircle, 
  UploadCloud, 
  Download, 
  RefreshCw,
  AlertCircle,
  Layers,
  Sparkles,
  Check,
  AlertTriangle,
  PlusCircle,
  HelpCircle,
  Info,
  ShieldCheck
} from 'lucide-react';
import { 
  MasterDataTab, 
  Employee, 
  Department, 
  Press, 
  Furnace, 
  FurnaceCar, 
  Product, 
  ProductType,
  Customer, 
  Shift,
  NavigationPage
} from '../../types';
import { 
  fetchMasterData, 
  subscribeMasterData, 
  createMasterDataItem, 
  updateMasterDataItem, 
  toggleMasterDataActive, 
  deleteMasterDataItem 
} from '../../services/masterDataService';
import {
  subscribeProductTypes,
  createProductType,
  updateProductType,
  toggleProductTypeActive
} from '../../services/productTypeService';
import { parseProductCode, normalizeProductCode } from '../../utils/productCodeParser';
import { enrichWithNormalizedFields } from '../../utils/searchUtils';
import { DataQualityModal } from '../admin/DataQualityModal';
import { exportMasterDataToExcel } from '../../services/exportService';
import { Badge } from '../common/Badge';
import { Modal } from '../common/Modal';
import { db } from '../../config/firebase';
import { writeBatch, doc, serverTimestamp } from 'firebase/firestore';
import { logAuditAction } from '../../services/auditService';
import { toWesternDigits } from '../../utils/formatters';

interface CodeAnalysisItem {
  product: Product;
  parseResult: ReturnType<typeof parseProductCode>;
  needsUpdate: boolean;
  proposedChanges: {
    productTypePrefix?: string;
    productTypeId?: string;
    productTypeName?: string;
    productTypeNameAr?: string;
    aluminaPercentage?: number;
    productIdentifier?: string;
    code?: string;
    productCode?: string;
    smartParseStatus?: string;
    productCodeNormalized?: string;
    nameNormalized?: string;
    productTypePrefixNormalized?: string;
    productTypeNameNormalized?: string;
  };
}

interface MasterDataViewProps {
  onNavigate: (page: NavigationPage) => void;
}

export const MasterDataView: React.FC<MasterDataViewProps> = ({ onNavigate }) => {
  const [activeTab, setActiveTab] = useState<MasterDataTab>('products');
  const [items, setItems] = useState<any[]>([]);
  const [productTypes, setProductTypes] = useState<ProductType[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [furnaces, setFurnaces] = useState<Furnace[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [prefixFilter, setPrefixFilter] = useState<string>('all');

  // Modal States
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [editingItem, setEditingItem] = useState<any | null>(null);
  const [formData, setFormData] = useState<Record<string, any>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [deleteConfirmItem, setDeleteConfirmItem] = useState<any | null>(null);

  // Quick New Product Type Modal from inside Product Form
  const [isQuickTypeModalOpen, setIsQuickTypeModalOpen] = useState<boolean>(false);
  const [quickTypePrefix, setQuickTypePrefix] = useState<string>('');
  const [quickTypeNameEn, setQuickTypeNameEn] = useState<string>('');
  const [quickTypeNameAr, setQuickTypeNameAr] = useState<string>('');
  const [quickTypeDescription, setQuickTypeDescription] = useState<string>('');
  const [quickTypeError, setQuickTypeError] = useState<string | null>(null);
  const [isQuickTypeSaving, setIsQuickTypeSaving] = useState<boolean>(false);
  const [manualOverrideAlumina, setManualOverrideAlumina] = useState<boolean>(false);

  // Analyze Existing Product Codes Modal State
  const [isAnalyzeModalOpen, setIsAnalyzeModalOpen] = useState<boolean>(false);
  const [isQualityModalOpen, setIsQualityModalOpen] = useState<boolean>(false);
  const [analyzedItems, setAnalyzedItems] = useState<CodeAnalysisItem[]>([]);
  const [isApplyingAnalysis, setIsApplyingAnalysis] = useState<boolean>(false);
  const [analysisAppliedMessage, setAnalysisAppliedMessage] = useState<string | null>(null);

  const tabs: { id: MasterDataTab; label: string; icon: React.ElementType }[] = [
    { id: 'products', label: 'المنتجات الحرارية', icon: Box },
    { id: 'productTypes', label: 'تصنيفات المنتجات (Prefixes)', icon: Layers },
    { id: 'employees', label: 'العمال والموظفون', icon: Users },
    { id: 'presses', label: 'المكابس', icon: Cpu },
    { id: 'furnaces', label: 'الأفران', icon: Flame },
    { id: 'furnaceCars', label: 'عربات الأفران', icon: Truck },
    { id: 'customers', label: 'العملاء', icon: Building },
    { id: 'departments', label: 'الأقسام', icon: Building2 },
    { id: 'shifts', label: 'ورديات العمل', icon: Clock },
  ];

  // Subscribe to Product Types (always kept live for parser)
  useEffect(() => {
    const unsubTypes = subscribeProductTypes(
      (types) => setProductTypes(types),
      (err) => console.warn('Product types listener warning:', err)
    );
    return () => unsubTypes();
  }, []);

  // Subscribe to current collection
  useEffect(() => {
    setIsLoading(true);
    const unsubscribe = subscribeMasterData<any>(
      activeTab,
      (data) => {
        setItems(data);
        setIsLoading(false);
      },
      (err) => {
        console.error(`Error loading ${activeTab}:`, err);
        setIsLoading(false);
      }
    );

    return () => unsubscribe();
  }, [activeTab]);

  // Load auxiliary lists (departments & furnaces for dropdowns)
  useEffect(() => {
    fetchMasterData<Department>('departments').then(setDepartments).catch(() => {});
    fetchMasterData<Furnace>('furnaces').then(setFurnaces).catch(() => {});
  }, []);

  // Real-time parsed result for Product code in modal
  const liveProductParseResult = useMemo(() => {
    if (activeTab !== 'products' || !formData.code) {
      return null;
    }
    return parseProductCode(formData.code, productTypes);
  }, [activeTab, formData.code, productTypes]);

  // Handle live updates to product form when valid code is typed
  const handleProductCodeChange = (rawCode: string) => {
    const normalized = normalizeProductCode(rawCode);
    const parseRes = parseProductCode(normalized, productTypes);

    const updated: Record<string, any> = {
      ...formData,
      code: normalized,
      productCode: normalized,
    };

    if (parseRes.smartParseStatus === 'SMART_CODE' && parseRes.productType) {
      updated.productTypePrefix = parseRes.prefix;
      updated.productTypeId = parseRes.productType.id || '';
      updated.productTypeName = parseRes.productType.nameEn;
      updated.productTypeNameAr = parseRes.productType.nameAr;
      updated.productIdentifier = parseRes.productIdentifier;

      // Auto-set Alumina if not manually overridden
      if (!manualOverrideAlumina && parseRes.aluminaPercentage !== undefined) {
        updated.aluminaPercentage = parseRes.aluminaPercentage;
      }

      // Auto-set suggested Category and Name if currently empty
      if (!formData.category || formData.category.trim() === '') {
        updated.category = parseRes.productType.nameAr || parseRes.productType.nameEn;
      }
      if (!formData.name || formData.name.trim() === '' || formData.name === parseRes.suggestedNameAr) {
        if (parseRes.suggestedNameAr) {
          updated.name = parseRes.suggestedNameAr;
        }
      }
    } else if (parseRes.smartParseStatus === 'UNKNOWN_PREFIX') {
      updated.productTypePrefix = parseRes.prefix;
      updated.productIdentifier = parseRes.productIdentifier;
      if (!manualOverrideAlumina && parseRes.aluminaPercentage !== undefined) {
        updated.aluminaPercentage = parseRes.aluminaPercentage;
      }
    } else {
      // MANUAL_PRODUCT_CODE (starts with digit or custom):
      // Do NOT derive alumina, product type, prefix, or identifier
      if (!formData.isManualClassification) {
        updated.productTypePrefix = '';
        updated.productIdentifier = '';
      }
    }

    setFormData(updated);
  };

  // Filter items
  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      // Status filter
      if (statusFilter === 'active' && item.active === false) return false;
      if (statusFilter === 'inactive' && item.active !== false) return false;

      // Product Prefix filter
      if (activeTab === 'products' && prefixFilter !== 'all') {
        const itemPrefix = item.productTypePrefix || (item.code ? item.code.substring(0, 3).toUpperCase() : '');
        if (itemPrefix !== prefixFilter) return false;
      }

      // Search filter
      if (searchQuery.trim() !== '') {
        const q = searchQuery.toLowerCase().trim();
        const codeMatch = item.code?.toLowerCase().includes(q) || item.prefixCode?.toLowerCase().includes(q);
        const nameMatch = item.name?.toLowerCase().includes(q) || item.nameEn?.toLowerCase().includes(q) || item.nameAr?.toLowerCase().includes(q);
        const categoryMatch = item.category?.toLowerCase().includes(q) || item.productTypeName?.toLowerCase().includes(q) || item.productTypeNameAr?.toLowerCase().includes(q);
        const jobTitleMatch = item.jobTitle?.toLowerCase().includes(q);
        const companyMatch = item.company?.toLowerCase().includes(q);
        const carNumberMatch = item.carNumber?.toLowerCase().includes(q);
        const aluminaMatch = item.aluminaPercentage !== undefined && String(item.aluminaPercentage).includes(q);
        const prefixMatch = item.productTypePrefix?.toLowerCase().includes(q);

        return Boolean(
          codeMatch || 
          nameMatch || 
          categoryMatch || 
          jobTitleMatch || 
          companyMatch || 
          carNumberMatch || 
          aluminaMatch || 
          prefixMatch
        );
      }

      return true;
    });
  }, [items, statusFilter, prefixFilter, searchQuery, activeTab]);

  const handleOpenAdd = () => {
    setEditingItem(null);
    setFormError(null);
    setManualOverrideAlumina(false);

    if (activeTab === 'products') {
      setFormData({
        code: '',
        name: '',
        category: '',
        aluminaPercentage: 25,
        pieceWeight: 4.5,
        pieceWeightKg: 4.5,
        unit: 'قطعة',
        dimensions: '230x114x65 مم',
        description: '',
        active: true,
      });
    } else if (activeTab === 'productTypes') {
      setFormData({
        prefixCode: '',
        nameEn: '',
        nameAr: '',
        description: '',
        active: true,
      });
    } else if (activeTab === 'employees') {
      setFormData({ code: '', name: '', jobTitle: '', departmentId: '', departmentName: '', phone: '', active: true });
    } else if (activeTab === 'presses') {
      setFormData({ code: '', name: '', tonnage: 1200, model: '', status: 'active', active: true });
    } else if (activeTab === 'furnaces') {
      setFormData({ code: '', name: '', capacity: 50, maxTemperature: 1650, status: 'active', active: true });
    } else if (activeTab === 'furnaceCars') {
      setFormData({ code: '', carNumber: '', furnaceId: '', furnaceName: '', capacity: 1200, active: true });
    } else if (activeTab === 'customers') {
      setFormData({ code: '', name: '', company: '', phone: '', email: '', address: '', active: true });
    } else if (activeTab === 'departments') {
      setFormData({ code: '', name: '', description: '', active: true });
    } else if (activeTab === 'shifts') {
      setFormData({ code: '', name: '', startTime: '08:00', endTime: '16:00', hours: 8, active: true });
    }
    setIsModalOpen(true);
  };

  const handleOpenEdit = (item: any) => {
    setEditingItem(item);
    setFormError(null);
    setManualOverrideAlumina(false);
    setFormData({ ...item });
    setIsModalOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setIsSaving(true);

    try {
      if (activeTab === 'productTypes') {
        const prefix = (formData.prefixCode || '').trim().toUpperCase();
        if (!/^[A-Z0-9]{3}$/.test(prefix)) {
          throw new Error('بادئة الكود (Prefix Code) يجب أن تتكون من 3 أحرف باللغة الإنجليزية بالضبط (مثال: BAR, BHA).');
        }
        if (!formData.nameEn || !formData.nameEn.trim()) {
          throw new Error('الاسم باللغة الإنجليزية إلزامي لتصنيف المنتج.');
        }
        if (!formData.nameAr || !formData.nameAr.trim()) {
          throw new Error('الاسم باللغة العربية إلزامي لتصنيف المنتج.');
        }

        if (editingItem && editingItem.id) {
          await updateProductType(editingItem.id, {
            prefixCode: prefix,
            nameEn: formData.nameEn.trim(),
            nameAr: formData.nameAr.trim(),
            description: formData.description || '',
            active: formData.active !== false,
          });
        } else {
          await createProductType({
            prefixCode: prefix,
            nameEn: formData.nameEn.trim(),
            nameAr: formData.nameAr.trim(),
            description: formData.description || '',
            active: formData.active !== false,
          });
        }
        setIsModalOpen(false);
        return;
      }

      // Products validation (Optional Smart Parsing & Non-blocking)
      if (activeTab === 'products') {
        const normalizedCode = normalizeProductCode(formData.code || '');
        if (!normalizedCode) {
          throw new Error('حقل كود المنتج إلزامي.');
        }
        if (!formData.name || !formData.name.trim()) {
          throw new Error('حقل اسم المنتج إلزامي.');
        }

        const parseResult = parseProductCode(normalizedCode, productTypes);

        formData.code = normalizedCode;
        formData.productCode = normalizedCode;
        formData.name = formData.name.trim();

        // Optional Alumina Percentage validation (if provided, must be 0-100)
        if (formData.aluminaPercentage !== undefined && formData.aluminaPercentage !== null && String(formData.aluminaPercentage).trim() !== '') {
          const aluminaNum = Number(formData.aluminaPercentage);
          if (isNaN(aluminaNum) || aluminaNum < 0 || aluminaNum > 100) {
            throw new Error('نسبة الألومينا يجب أن تكون رقماً بين 0% و 100%.');
          }
          formData.aluminaPercentage = aluminaNum;
        } else {
          formData.aluminaPercentage = null;
        }

        // Optional Piece Weight validation
        if (formData.pieceWeight !== undefined && formData.pieceWeight !== null && String(formData.pieceWeight).trim() !== '') {
          const weightNum = Number(formData.pieceWeight);
          if (isNaN(weightNum) || weightNum <= 0) {
            throw new Error('وزن القطعة (كجم) يجب أن يكون قيمة رقمية أكبر من الصفر.');
          }
          formData.pieceWeight = weightNum;
          formData.pieceWeightKg = weightNum;
        } else {
          formData.pieceWeight = null;
          formData.pieceWeightKg = null;
        }

        // Apply derived smart classification if recognized
        if (parseResult.status === 'RECOGNIZED' && parseResult.productType) {
          formData.productTypePrefix = parseResult.prefix;
          formData.productTypeId = parseResult.productType.id || '';
          formData.productTypeName = parseResult.productType.nameEn;
          formData.productTypeNameAr = parseResult.productType.nameAr;
          formData.productIdentifier = parseResult.productIdentifier;
          formData.smartParseStatus = 'RECOGNIZED';
          if (formData.aluminaPercentage === null && parseResult.aluminaPercentage !== undefined) {
            formData.aluminaPercentage = parseResult.aluminaPercentage;
          }
        } else if (parseResult.status === 'PARTIAL') {
          formData.productTypePrefix = parseResult.prefix;
          formData.productIdentifier = parseResult.productIdentifier;
          formData.smartParseStatus = 'PARTIAL';
          if (formData.aluminaPercentage === null && parseResult.aluminaPercentage !== undefined) {
            formData.aluminaPercentage = parseResult.aluminaPercentage;
          }
        } else {
          formData.smartParseStatus = 'NOT_APPLICABLE';
        }
      }

      if (!formData.code || !formData.code.trim()) {
        throw new Error('حقل الكود إلزامي.');
      }
      if (!formData.name && activeTab !== 'furnaceCars') {
        throw new Error('حقل الاسم إلزامي.');
      }

      // Fill auxiliary names if needed
      if (activeTab === 'employees' && formData.departmentId) {
        const found = departments.find((d) => d.id === formData.departmentId);
        if (found) formData.departmentName = found.name;
      }
      if (activeTab === 'furnaceCars' && formData.furnaceId) {
        const found = furnaces.find((f) => f.id === formData.furnaceId);
        if (found) formData.furnaceName = found.name;
      }

      if (editingItem && editingItem.id) {
        await updateMasterDataItem(activeTab, editingItem.id, formData);
      } else {
        await createMasterDataItem(activeTab, formData);
      }

      setIsModalOpen(false);
    } catch (err: any) {
      setFormError(err.message || 'حدث خطأ أثناء حفظ البيانات.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleToggleStatus = async (item: any) => {
    try {
      if (activeTab === 'productTypes') {
        await toggleProductTypeActive(item.id, item.active !== false, item.prefixCode);
      } else {
        await toggleMasterDataActive(activeTab, item.id, item.active !== false);
      }
    } catch (err) {
      console.error('Error toggling status:', err);
    }
  };

  const handleDelete = async () => {
    if (!deleteConfirmItem || !deleteConfirmItem.id) return;
    try {
      if (activeTab === 'productTypes') {
        await toggleProductTypeActive(deleteConfirmItem.id, true, deleteConfirmItem.prefixCode);
      } else {
        await deleteMasterDataItem(activeTab, deleteConfirmItem.id, deleteConfirmItem.code || deleteConfirmItem.name);
      }
      setDeleteConfirmItem(null);
    } catch (err) {
      console.error('Error deleting item:', err);
    }
  };

  // Quick New Product Type Creation
  const handleOpenQuickType = (prefix: string) => {
    setQuickTypePrefix(prefix.toUpperCase());
    setQuickTypeNameEn('');
    setQuickTypeNameAr('');
    setQuickTypeDescription(`تصنيف نوع المنتج للبادئة (${prefix.toUpperCase()})`);
    setQuickTypeError(null);
    setIsQuickTypeModalOpen(true);
  };

  const handleSaveQuickType = async (e: React.FormEvent) => {
    e.preventDefault();
    setQuickTypeError(null);
    setIsQuickTypeSaving(true);

    try {
      const prefix = quickTypePrefix.trim().toUpperCase();
      if (!/^[A-Z0-9]{3}$/.test(prefix)) {
        throw new Error('بادئة الكود يجب أن تتكون من 3 أحرف باللغة الإنجليزية بالضبط.');
      }
      if (!quickTypeNameEn.trim()) throw new Error('الاسم بالإنجليزية إلزامي.');
      if (!quickTypeNameAr.trim()) throw new Error('الاسم بالعربية إلزامي.');

      const newId = await createProductType({
        prefixCode: prefix,
        nameEn: quickTypeNameEn.trim(),
        nameAr: quickTypeNameAr.trim(),
        description: quickTypeDescription.trim(),
        active: true,
      });

      // Update local productTypes cache immediately so live parser picks it up instantly
      const newType: ProductType = {
        id: newId,
        prefixCode: prefix,
        nameEn: quickTypeNameEn.trim(),
        nameAr: quickTypeNameAr.trim(),
        description: quickTypeDescription.trim(),
        active: true,
      };
      setProductTypes((prev) => [...prev, newType]);

      // Re-trigger product form auto-population
      if (formData.code) {
        handleProductCodeChange(formData.code);
      }

      setIsQuickTypeModalOpen(false);
    } catch (err: any) {
      setQuickTypeError(err.message || 'فشل حفظ نوع المنتج الجديد.');
    } finally {
      setIsQuickTypeSaving(false);
    }
  };

  // Analyze Existing Products Action
  const handleOpenAnalyzeCodes = () => {
    setAnalysisAppliedMessage(null);
    const analysis: CodeAnalysisItem[] = items.map((prod: Product) => {
      const normalizedCode = normalizeProductCode(prod.code || prod.productCode || '');
      const parseRes = parseProductCode(normalizedCode, productTypes);

      const proposedChanges: CodeAnalysisItem['proposedChanges'] = {};
      let needsUpdate = false;

      // Smart parse status check
      if (prod.smartParseStatus !== parseRes.smartParseStatus) {
        proposedChanges.smartParseStatus = parseRes.smartParseStatus;
        needsUpdate = true;
      }

      // Normalized search fields check
      const normalizedObj = enrichWithNormalizedFields(
        'products',
        {
          code: normalizedCode,
          name: prod.name || prod.productName,
          productTypePrefix: parseRes.prefix || prod.productTypePrefix,
          productTypeName: parseRes.productType?.nameEn || prod.productTypeName,
        }
      );

      if (prod.productCodeNormalized !== normalizedObj.productCodeNormalized) {
        proposedChanges.productCodeNormalized = normalizedObj.productCodeNormalized;
        needsUpdate = true;
      }
      if (prod.nameNormalized !== normalizedObj.nameNormalized) {
        proposedChanges.nameNormalized = normalizedObj.nameNormalized;
        needsUpdate = true;
      }
      if (normalizedObj.productTypePrefixNormalized && prod.productTypePrefixNormalized !== normalizedObj.productTypePrefixNormalized) {
        proposedChanges.productTypePrefixNormalized = normalizedObj.productTypePrefixNormalized;
        needsUpdate = true;
      }
      if (normalizedObj.productTypeNameNormalized && prod.productTypeNameNormalized !== normalizedObj.productTypeNameNormalized) {
        proposedChanges.productTypeNameNormalized = normalizedObj.productTypeNameNormalized;
        needsUpdate = true;
      }

      // CASE A: SMART_CODE
      if (parseRes.smartParseStatus === 'SMART_CODE' && parseRes.productType) {
        if (!prod.productTypePrefix || prod.productTypePrefix !== parseRes.prefix) {
          proposedChanges.productTypePrefix = parseRes.prefix;
          needsUpdate = true;
        }
        if (!prod.productTypeId || prod.productTypeId !== parseRes.productType.id) {
          proposedChanges.productTypeId = parseRes.productType.id;
          needsUpdate = true;
        }
        if (!prod.productTypeName || prod.productTypeName !== parseRes.productType.nameEn) {
          proposedChanges.productTypeName = parseRes.productType.nameEn;
          needsUpdate = true;
        }
        if (!prod.productTypeNameAr || prod.productTypeNameAr !== parseRes.productType.nameAr) {
          proposedChanges.productTypeNameAr = parseRes.productType.nameAr;
          needsUpdate = true;
        }
        if (parseRes.aluminaPercentage !== undefined && (prod.aluminaPercentage === undefined || prod.aluminaPercentage === null)) {
          proposedChanges.aluminaPercentage = parseRes.aluminaPercentage;
          needsUpdate = true;
        }
        if (parseRes.productIdentifier && (!prod.productIdentifier || prod.productIdentifier !== parseRes.productIdentifier)) {
          proposedChanges.productIdentifier = parseRes.productIdentifier;
          needsUpdate = true;
        }
        if (prod.code !== normalizedCode) {
          proposedChanges.code = normalizedCode;
          proposedChanges.productCode = normalizedCode;
          needsUpdate = true;
        }
      } 
      // CASE B: UNKNOWN_PREFIX
      else if (parseRes.smartParseStatus === 'UNKNOWN_PREFIX') {
        if (!prod.productTypePrefix || prod.productTypePrefix !== parseRes.prefix) {
          proposedChanges.productTypePrefix = parseRes.prefix;
          needsUpdate = true;
        }
        if (parseRes.aluminaPercentage !== undefined && (prod.aluminaPercentage === undefined || prod.aluminaPercentage === null)) {
          proposedChanges.aluminaPercentage = parseRes.aluminaPercentage;
          needsUpdate = true;
        }
        if (parseRes.productIdentifier && (!prod.productIdentifier || prod.productIdentifier !== parseRes.productIdentifier)) {
          proposedChanges.productIdentifier = parseRes.productIdentifier;
          needsUpdate = true;
        }
        if (prod.code !== normalizedCode) {
          proposedChanges.code = normalizedCode;
          proposedChanges.productCode = normalizedCode;
          needsUpdate = true;
        }
      }
      // CASE C & D: MANUAL_PRODUCT_CODE (Starts with digit or custom format)
      // DO NOT derive Alumina! Preserve existing manual values.
      else {
        if (prod.code !== normalizedCode) {
          proposedChanges.code = normalizedCode;
          proposedChanges.productCode = normalizedCode;
          needsUpdate = true;
        }
      }

      return {
        product: prod,
        parseResult: parseRes,
        needsUpdate,
        proposedChanges,
      };
    });

    setAnalyzedItems(analysis);
    setIsAnalyzeModalOpen(true);
  };

  const handleApplyAnalysis = async () => {
    const updatable = analyzedItems.filter((i) => i.needsUpdate && i.product.id);
    if (updatable.length === 0) return;

    setIsApplyingAnalysis(true);
    try {
      // Chunk batches by 400 for safety
      const chunkSize = 400;
      for (let i = 0; i < updatable.length; i += chunkSize) {
        const chunk = updatable.slice(i, i + chunkSize);
        const batch = writeBatch(db);

        for (const item of chunk) {
          if (item.product.id) {
            const ref = doc(db, 'products', item.product.id);
            batch.update(ref, {
              ...item.proposedChanges,
              updatedAt: serverTimestamp(),
            });
          }
        }

        await batch.commit();
      }

      await logAuditAction(
        'BULK_UPDATE_PRODUCT_INTELLIGENCE',
        'products',
        'bulk',
        `تم تطبيق التحديث الذكي وتوليد الحقول المشتقة وتطبيع الفهارس لعدد (${updatable.length}) منتج بنجاح`
      );

      setAnalysisAppliedMessage(`تم تحديث وتطبيع بيانات (${updatable.length}) منتج بالمعلومات المشتقة بنجاح مع الحفاظ على الأكواد الرقمية والمدخلات اليدوية دون المساس بالأوزان أو الأبعاد.`);
      
      // Re-run analysis to reflect updated state
      setTimeout(() => {
        handleOpenAnalyzeCodes();
      }, 800);
    } catch (err: any) {
      console.error('Error applying analysis:', err);
      alert('حدث خطأ أثناء تطبيق التحديث: ' + (err.message || 'خطأ غير معروف'));
    } finally {
      setIsApplyingAnalysis(false);
    }
  };

  const handleExport = () => {
    const currentTabObj = tabs.find((t) => t.id === activeTab);
    exportMasterDataToExcel(
      filteredItems,
      currentTabObj?.label || activeTab,
      `بيانات_${currentTabObj?.label || activeTab}.xlsx`
    );
  };

  return (
    <div className="space-y-6">
      {/* Master Data Tabs Bar */}
      <div className="bg-white rounded-2xl p-2 border border-slate-200 shadow-xs flex items-center gap-1.5 overflow-x-auto">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              id={`tab-${tab.id}`}
              type="button"
              onClick={() => {
                setActiveTab(tab.id);
                setSearchQuery('');
                setStatusFilter('all');
                setPrefixFilter('all');
              }}
              className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold transition-all shrink-0 cursor-pointer ${
                isActive
                  ? 'bg-amber-400 text-slate-950 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
              }`}
            >
              <Icon className={`w-4 h-4 ${isActive ? 'text-slate-950' : 'text-slate-500'}`} />
              <span>{tab.label}</span>
              <span
                className={`text-[10px] px-1.5 py-0.2 rounded font-semibold ${
                  isActive ? 'bg-slate-900 text-amber-300' : 'bg-slate-100 text-slate-500'
                }`}
              >
                {activeTab === tab.id ? items.length : ''}
              </span>
            </button>
          );
        })}
      </div>

      {/* Control Bar: Search, Filters, Add Button, Bulk Import Link, Excel Export */}
      <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-xs flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
        {/* Search & Status Filter */}
        <div className="flex flex-1 flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[220px] max-w-md">
            <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none text-slate-400">
              <Search className="w-4 h-4" />
            </div>
            <input
              id="master-data-search-input"
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={
                activeTab === 'products'
                  ? 'البحث بالكود الذكي (مثال: BAR25)، البادئة، نسبة الألومينا، أو الاسم...'
                  : activeTab === 'productTypes'
                  ? 'البحث بالبادئة (BAR, BHA) أو الاسم بالإنجليزية/العربية...'
                  : 'البحث بالكود، الاسم، أو التصنيف...'
              }
              className="w-full bg-slate-50 border border-slate-200 rounded-xl pr-9 pl-4 py-2 text-xs text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-amber-500 focus:bg-white transition-colors"
            />
          </div>

          {/* Product Prefix Dropdown Filter (when on products tab) */}
          {activeTab === 'products' && (
            <select
              value={prefixFilter}
              onChange={(e) => setPrefixFilter(e.target.value)}
              className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-700 font-bold focus:outline-none focus:border-amber-500"
            >
              <option value="all">جميع البادئات ({productTypes.length})</option>
              {productTypes.map((pt) => (
                <option key={pt.prefixCode} value={pt.prefixCode}>
                  {pt.prefixCode} - {pt.nameAr || pt.nameEn}
                </option>
              ))}
            </select>
          )}

          <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl">
            <button
              type="button"
              onClick={() => setStatusFilter('all')}
              className={`px-3 py-1 text-xs font-bold rounded-lg transition-colors cursor-pointer ${
                statusFilter === 'all' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              الكل ({items.length})
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter('active')}
              className={`px-3 py-1 text-xs font-bold rounded-lg transition-colors cursor-pointer ${
                statusFilter === 'active' ? 'bg-white text-emerald-700 shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              النشط
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter('inactive')}
              className={`px-3 py-1 text-xs font-bold rounded-lg transition-colors cursor-pointer ${
                statusFilter === 'inactive' ? 'bg-white text-rose-700 shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              المعطل
            </button>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2 flex-wrap">
          <button
            id="master-data-quality-btn"
            type="button"
            onClick={() => setIsQualityModalOpen(true)}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-bold text-emerald-850 bg-emerald-50 border border-emerald-300 hover:bg-emerald-100 rounded-xl transition-colors cursor-pointer"
            title="فحص شامل لسلامة وتناسق البيانات واكتشاف الأكواد المكررة وتصنيفات الأكواد الرقمية"
          >
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
            <span>فحص جودة البيانات</span>
          </button>

          {activeTab === 'products' && (
            <button
              id="master-data-analyze-codes-btn"
              type="button"
              onClick={handleOpenAnalyzeCodes}
              className="flex items-center gap-1.5 px-3 py-2 text-xs font-bold text-indigo-800 bg-indigo-50 border border-indigo-200 hover:bg-indigo-100 rounded-xl transition-colors cursor-pointer"
              title="فحص واستخراج الحقول المشتقة لمنتجات قاعدة البيانات الحالية دون المساس بالأوزان أو الأبعاد"
            >
              <Sparkles className="w-3.5 h-3.5 text-indigo-600" />
              <span>تحليل الأكواد الحالية</span>
            </button>
          )}

          <button
            id="master-data-export-btn"
            type="button"
            onClick={handleExport}
            disabled={filteredItems.length === 0}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors disabled:opacity-50 cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            <span>تصدير Excel</span>
          </button>

          {activeTab !== 'productTypes' && (
            <button
              id="master-data-bulk-link-btn"
              type="button"
              onClick={() => onNavigate('bulk-entry')}
              className="flex items-center gap-1.5 px-3 py-2 text-xs font-bold text-slate-700 bg-amber-50 border border-amber-200 hover:bg-amber-100 rounded-xl transition-colors cursor-pointer"
            >
              <UploadCloud className="w-3.5 h-3.5 text-amber-700" />
              <span>استيراد مجمع</span>
            </button>
          )}

          <button
            id="master-data-add-btn"
            type="button"
            onClick={handleOpenAdd}
            className="flex items-center gap-1.5 px-4 py-2 text-xs font-extrabold text-slate-950 bg-amber-400 hover:bg-amber-500 rounded-xl shadow-xs transition-colors cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>
              {activeTab === 'productTypes' ? 'إضافة تصنيف جديد (Prefix)' : 'إضافة سجل جديد'}
            </span>
          </button>
        </div>
      </div>

      {/* Master Data Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        {isLoading ? (
          <div className="py-16 text-center text-slate-400">
            <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-amber-500" />
            <p className="text-xs font-semibold">جارٍ تحميل البيانات من Firestore...</p>
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="py-16 text-center text-slate-400">
            <AlertCircle className="w-8 h-8 mx-auto mb-2 text-slate-300" />
            <p className="text-sm font-bold text-slate-700">لا توجد سجلات مطابقة</p>
            <p className="text-xs text-slate-400 mt-1">
              يمكنك إضافة سجل جديد أو استخدام الاستيراد المجمع لرفع ملفات Excel.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-right text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-bold">
                <tr>
                  {activeTab === 'productTypes' ? (
                    <>
                      <th className="px-4 py-3.5">البادئة (Prefix)</th>
                      <th className="px-4 py-3.5">الاسم بالإنجليزية (Name EN)</th>
                      <th className="px-4 py-3.5">الاسم بالعربية (Name AR)</th>
                      <th className="px-4 py-3.5">الوصف والبيان</th>
                    </>
                  ) : (
                    <>
                      <th className="px-4 py-3.5">الكود</th>
                      <th className="px-4 py-3.5">الاسم / البيان</th>
                    </>
                  )}

                  {activeTab === 'products' && (
                    <>
                      <th className="px-4 py-3.5">نوع المنتج / البادئة</th>
                      <th className="px-4 py-3.5">نسبة الألومينا</th>
                      <th className="px-4 py-3.5">المعرف الداخلي</th>
                      <th className="px-4 py-3.5">وزن القطعة (كجم)</th>
                      <th className="px-4 py-3.5">الأبعاد</th>
                    </>
                  )}
                  {activeTab === 'employees' && (
                    <>
                      <th className="px-4 py-3.5">المسمى الوظيفي</th>
                      <th className="px-4 py-3.5">القسم</th>
                      <th className="px-4 py-3.5">الهاتف</th>
                    </>
                  )}
                  {activeTab === 'presses' && (
                    <>
                      <th className="px-4 py-3.5">الحمولة</th>
                      <th className="px-4 py-3.5">الموديل</th>
                      <th className="px-4 py-3.5">الحالة التشغيلية</th>
                    </>
                  )}
                  {activeTab === 'furnaces' && (
                    <>
                      <th className="px-4 py-3.5">السعة (طن)</th>
                      <th className="px-4 py-3.5">أقصى حرارة</th>
                      <th className="px-4 py-3.5">الحالة</th>
                    </>
                  )}
                  {activeTab === 'furnaceCars' && (
                    <>
                      <th className="px-4 py-3.5">رقم العربة</th>
                      <th className="px-4 py-3.5">الفرن المخصص</th>
                      <th className="px-4 py-3.5">السعة</th>
                    </>
                  )}
                  {activeTab === 'customers' && (
                    <>
                      <th className="px-4 py-3.5">الشركة</th>
                      <th className="px-4 py-3.5">الهاتف</th>
                      <th className="px-4 py-3.5">البريد</th>
                    </>
                  )}
                  {activeTab === 'shifts' && (
                    <>
                      <th className="px-4 py-3.5">ساعات العمل</th>
                      <th className="px-4 py-3.5">المواعيد</th>
                    </>
                  )}
                  <th className="px-4 py-3.5">حالة التفعيل</th>
                  <th className="px-4 py-3.5 text-center">الإجراءات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-medium text-slate-700">
                {filteredItems.map((item) => (
                  <tr key={item.id} className="hover:bg-slate-50/80 transition-colors">
                    {activeTab === 'productTypes' ? (
                      <>
                        <td className="px-4 py-3">
                          <span className="inline-flex items-center px-2.5 py-1 rounded-lg font-mono font-black text-xs bg-indigo-50 border border-indigo-200 text-indigo-700">
                            {item.prefixCode}
                          </span>
                        </td>
                        <td className="px-4 py-3 font-bold text-slate-900 font-sans" dir="ltr">
                          {item.nameEn}
                        </td>
                        <td className="px-4 py-3 font-bold text-slate-800">
                          {item.nameAr}
                        </td>
                        <td className="px-4 py-3 text-slate-500 text-[11px]">
                          {item.description || '-'}
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="px-4 py-3 font-mono font-bold text-slate-900">
                          {item.code || '-'}
                        </td>
                        <td className="px-4 py-3 font-bold text-slate-800">
                          {item.name || item.carNumber || '-'}
                        </td>
                      </>
                    )}

                    {/* Products details */}
                    {activeTab === 'products' && (
                      <>
                        <td className="px-4 py-3">
                          {item.productTypePrefix ? (
                            <div className="flex items-center gap-1.5">
                              <span className="px-2 py-0.5 rounded font-mono font-bold text-[11px] bg-slate-900 text-amber-400">
                                {item.productTypePrefix}
                              </span>
                              <span className="text-slate-700 font-semibold text-[11px]">
                                {item.productTypeNameAr || item.productTypeName || item.category || '-'}
                              </span>
                            </div>
                          ) : (
                            <span className="text-slate-400 text-[11px]">تصنيف يدوي / سابق</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {item.aluminaPercentage !== undefined && item.aluminaPercentage !== null ? (
                            <Badge variant="amber">{item.aluminaPercentage}% ألومينا</Badge>
                          ) : (
                            <span className="text-slate-400 text-xs">غير محدد</span>
                          )}
                        </td>
                        <td className="px-4 py-3 font-mono text-slate-600">
                          {item.productIdentifier || (item.code && item.code.length > 5 ? item.code.substring(5) : '-')}
                        </td>
                        <td className="px-4 py-3 font-bold text-slate-900">
                          {item.pieceWeight || item.pieceWeightKg ? `${item.pieceWeight || item.pieceWeightKg} كجم` : <span className="text-slate-400 text-xs">-</span>}
                        </td>
                        <td className="px-4 py-3 font-mono text-slate-500">{item.dimensions || '-'}</td>
                      </>
                    )}

                    {/* Employees details */}
                    {activeTab === 'employees' && (
                      <>
                        <td className="px-4 py-3 text-slate-700">{item.jobTitle || '-'}</td>
                        <td className="px-4 py-3 text-slate-600">{item.departmentName || '-'}</td>
                        <td className="px-4 py-3 font-mono text-slate-500">{item.phone || '-'}</td>
                      </>
                    )}

                    {/* Presses details */}
                    {activeTab === 'presses' && (
                      <>
                        <td className="px-4 py-3 font-bold">{item.tonnage ? `${item.tonnage} طن` : '-'}</td>
                        <td className="px-4 py-3 text-slate-600">{item.model || '-'}</td>
                        <td className="px-4 py-3">
                          <Badge variant={item.status === 'active' ? 'success' : item.status === 'maintenance' ? 'warning' : 'danger'}>
                            {item.status === 'active' ? 'جاهز للعمل' : item.status === 'maintenance' ? 'صيانة' : 'معطل'}
                          </Badge>
                        </td>
                      </>
                    )}

                    {/* Furnaces details */}
                    {activeTab === 'furnaces' && (
                      <>
                        <td className="px-4 py-3 font-bold">{item.capacity ? `${item.capacity} طن` : '-'}</td>
                        <td className="px-4 py-3 text-rose-700 font-bold">{item.maxTemperature ? `${item.maxTemperature} °C` : '-'}</td>
                        <td className="px-4 py-3">
                          <Badge variant={item.status === 'active' ? 'success' : 'warning'}>
                            {item.status === 'active' ? 'يعمل' : 'صيانة'}
                          </Badge>
                        </td>
                      </>
                    )}

                    {/* Furnace Cars details */}
                    {activeTab === 'furnaceCars' && (
                      <>
                        <td className="px-4 py-3 font-mono font-bold text-slate-900">{item.carNumber}</td>
                        <td className="px-4 py-3 text-slate-600">{item.furnaceName || '-'}</td>
                        <td className="px-4 py-3">{item.capacity ? `${item.capacity} قطعة` : '-'}</td>
                      </>
                    )}

                    {/* Customers details */}
                    {activeTab === 'customers' && (
                      <>
                        <td className="px-4 py-3 font-bold">{item.company || '-'}</td>
                        <td className="px-4 py-3 font-mono text-slate-600">{item.phone || '-'}</td>
                        <td className="px-4 py-3 font-mono text-slate-500">{item.email || '-'}</td>
                      </>
                    )}

                    {/* Shifts details */}
                    {activeTab === 'shifts' && (
                      <>
                        <td className="px-4 py-3 font-bold">{item.hours} ساعات</td>
                        <td className="px-4 py-3 font-mono text-slate-500">
                          {item.startTime} &rarr; {item.endTime}
                        </td>
                      </>
                    )}

                    {/* Active toggle */}
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        onClick={() => handleToggleStatus(item)}
                        className="cursor-pointer"
                        title={item.active !== false ? 'تعطيل السجل' : 'تفعيل السجل'}
                      >
                        {item.active !== false ? (
                          <Badge variant="success">نشط</Badge>
                        ) : (
                          <Badge variant="danger">معطل</Badge>
                        )}
                      </button>
                    </td>

                    {/* Actions */}
                    <td className="px-4 py-3 text-center">
                      <div className="flex items-center justify-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => handleOpenEdit(item)}
                          className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors"
                          title="تعديل"
                        >
                          <Edit className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeleteConfirmItem(item)}
                          className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors"
                          title="حذف"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Add / Edit Modal */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title={
          editingItem
            ? `تعديل سجل في ${tabs.find((t) => t.id === activeTab)?.label}`
            : `إضافة سجل جديد في ${tabs.find((t) => t.id === activeTab)?.label}`
        }
        subtitle="جميع البيانات يتم التحقق منها ومزامنتها مباشرة مع قاعدة بيانات Firestore"
        maxWidth="lg"
      >
        <form onSubmit={handleSave} className="space-y-4">
          {formError && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-700 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{formError}</span>
            </div>
          )}

          {/* Form for Product Types (Prefix Master) */}
          {activeTab === 'productTypes' && (
            <>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  بادئة الكود (Prefix Code - 3 أحرف إنجليزية) *
                </label>
                <input
                  type="text"
                  maxLength={3}
                  required
                  value={formData.prefixCode || ''}
                  onChange={(e) => setFormData({ ...formData, prefixCode: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '') })}
                  placeholder="مثال: BAR, BHA, BSI"
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm font-mono font-bold uppercase text-slate-900 focus:outline-none focus:border-amber-500 focus:bg-white"
                />
                <p className="text-[11px] text-slate-500 mt-1">يجب أن تتكون البادئة من 3 أحرف لاتينية بالضبط مثل (BAR أو BHA).</p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    الاسم بالإنجليزية (Name in English) *
                  </label>
                  <input
                    type="text"
                    required
                    value={formData.nameEn || ''}
                    onChange={(e) => setFormData({ ...formData, nameEn: e.target.value })}
                    placeholder="e.g. Bricks Acid Resistance"
                    dir="ltr"
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2 text-xs text-slate-900 focus:outline-none focus:border-amber-500 focus:bg-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    الاسم بالعربية (Name in Arabic) *
                  </label>
                  <input
                    type="text"
                    required
                    value={formData.nameAr || ''}
                    onChange={(e) => setFormData({ ...formData, nameAr: e.target.value })}
                    placeholder="مثال: طوب مقاوم للأحماض"
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2 text-xs text-slate-900 focus:outline-none focus:border-amber-500 focus:bg-white"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">الوصف والبيان</label>
                <textarea
                  rows={2}
                  value={formData.description || ''}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder="ملاحظات ومواصفات نوع المنتج..."
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2 text-xs text-slate-900 focus:outline-none focus:border-amber-500 focus:bg-white"
                />
              </div>
            </>
          )}

          {/* Form for Products (Intelligent Structured Code) */}
          {activeTab === 'products' && (
            <>
              {/* Product Code Input with Live Intelligence */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs font-bold text-slate-700">
                    كود المنتج الذكي (Product Code) *
                  </label>
                  <span className="text-[10px] text-slate-400 font-mono">
                    [البادئة 3 أحرف] + [الألومينا خانتان] + [المعرف]
                  </span>
                </div>
                <input
                  id="product-form-code-input"
                  type="text"
                  required
                  value={formData.code || ''}
                  onChange={(e) => handleProductCodeChange(e.target.value)}
                  placeholder="مثال: BAR250102305 أو BHA70123456"
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm font-mono font-black uppercase text-slate-950 tracking-wider focus:outline-none focus:border-amber-500 focus:bg-white"
                />
              </div>

              {/* Real-time Parser Intelligence Card */}
              {liveProductParseResult && formData.code && (
                <div className={`p-3.5 rounded-xl border text-xs ${
                  liveProductParseResult.smartParseStatus === 'SMART_CODE'
                    ? 'bg-emerald-50/70 border-emerald-200 text-emerald-950'
                    : liveProductParseResult.smartParseStatus === 'UNKNOWN_PREFIX'
                    ? 'bg-amber-50/80 border-amber-200 text-amber-950'
                    : liveProductParseResult.smartParseStatus === 'INVALID_FORMAT'
                    ? 'bg-orange-50/80 border-orange-200 text-orange-950'
                    : 'bg-slate-50 border-slate-200 text-slate-800'
                }`}>
                  <div className="flex items-center justify-between pb-2 border-b border-black/5 mb-2.5">
                    <div className="flex items-center gap-1.5 font-bold">
                      {liveProductParseResult.smartParseStatus === 'SMART_CODE' ? (
                        <>
                          <Sparkles className="w-4 h-4 text-emerald-600" />
                          <span className="text-emerald-800">SMART CODE DETECTED (كود ذكي معتمد)</span>
                        </>
                      ) : liveProductParseResult.smartParseStatus === 'UNKNOWN_PREFIX' ? (
                        <>
                          <AlertTriangle className="w-4 h-4 text-amber-600" />
                          <span className="text-amber-800">UNKNOWN PRODUCT PREFIX (بادئة غير مسجلة)</span>
                        </>
                      ) : liveProductParseResult.smartParseStatus === 'INVALID_FORMAT' ? (
                        <>
                          <AlertTriangle className="w-4 h-4 text-orange-600" />
                          <span className="text-orange-800">INVALID SMART FORMAT — MANUAL ENTRY ALLOWED</span>
                        </>
                      ) : (
                        <>
                          <Info className="w-4 h-4 text-slate-500" />
                          <span className="text-slate-700">MANUAL CODE (كود يدوي / يبدأ برقم)</span>
                        </>
                      )}
                    </div>

                    <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-white/90 border border-black/10">
                      {liveProductParseResult.smartParseStatus === 'SMART_CODE' 
                        ? 'SMART_CODE ✅' 
                        : liveProductParseResult.smartParseStatus === 'UNKNOWN_PREFIX' 
                        ? 'UNKNOWN_PREFIX ⚠️' 
                        : liveProductParseResult.smartParseStatus === 'INVALID_FORMAT'
                        ? 'INVALID_FORMAT ✍️'
                        : 'MANUAL_CODE 🔢'}
                    </span>
                  </div>

                  {liveProductParseResult.smartParseStatus === 'SMART_CODE' || liveProductParseResult.smartParseStatus === 'UNKNOWN_PREFIX' ? (
                    <>
                      {/* 4 Detected Segments Grid */}
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center font-mono">
                        <div className="bg-white/80 p-2 rounded-lg border border-slate-200/60">
                          <span className="block text-[10px] text-slate-500 font-sans">1. البادئة (Prefix)</span>
                          <span className="text-xs font-black text-slate-900">{liveProductParseResult.prefix || '-'}</span>
                        </div>

                        <div className="bg-white/80 p-2 rounded-lg border border-slate-200/60">
                          <span className="block text-[10px] text-slate-500 font-sans">2. نوع المنتج (Type)</span>
                          <span className="text-[11px] font-bold text-indigo-700 truncate block">
                            {liveProductParseResult.productType?.nameAr || liveProductParseResult.productType?.nameEn || (
                              <span className="text-amber-700 font-sans">غير مسجل (يدوي)</span>
                            )}
                          </span>
                        </div>

                        <div className="bg-white/80 p-2 rounded-lg border border-slate-200/60">
                          <span className="block text-[10px] text-slate-500 font-sans">3. نسبة الألومينا</span>
                          <span className="text-xs font-black text-amber-700">
                            {liveProductParseResult.aluminaPercentage !== undefined ? `${liveProductParseResult.aluminaPercentage}%` : '-'}
                          </span>
                        </div>

                        <div className="bg-white/80 p-2 rounded-lg border border-slate-200/60">
                          <span className="block text-[10px] text-slate-500 font-sans">4. المعرف الداخلي</span>
                          <span className="text-xs font-bold text-slate-700">{liveProductParseResult.productIdentifier || '-'}</span>
                        </div>
                      </div>

                      {/* Unknown Prefix Action Banner */}
                      {liveProductParseResult.smartParseStatus === 'UNKNOWN_PREFIX' && liveProductParseResult.prefix.length === 3 && (
                        <div className="mt-3 pt-2.5 border-t border-amber-200/80 flex items-center justify-between flex-wrap gap-2">
                          <p className="text-[11px] text-amber-900">
                            البادئة <span className="font-mono font-bold">"{liveProductParseResult.prefix}"</span> غير مسجلة في جدول التصنيفات. يمكنك إضافتها الآن أو المتابعة بإدخال يدوي.
                          </p>
                          <button
                            type="button"
                            onClick={() => handleOpenQuickType(liveProductParseResult.prefix)}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs rounded-lg shadow-xs transition-colors cursor-pointer"
                          >
                            <PlusCircle className="w-3.5 h-3.5" />
                            <span>إضافة تصنيف {liveProductParseResult.prefix} الآن +</span>
                          </button>
                        </div>
                      )}
                    </>
                  ) : (
                    <p className="text-xs text-slate-600 leading-relaxed">
                      {liveProductParseResult.isNumericStart
                        ? 'كود يبدأ برقم: يُعامل كـ MANUAL_CODE بدون اشتقاق آلي لنسبة الألومينا. يمكنك إدخال نوع المنتج ونسبة الألومينا يدوياً.'
                        : 'كود ذو تنسيق مخصص: إدخال يدوي متاح بالكامل لجميع الحقول.'}
                    </p>
                  )}
                </div>
              )}

              {/* Product Name */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  اسم المنتج / التوصيف *
                </label>
                <input
                  id="product-form-name-input"
                  type="text"
                  required
                  value={formData.name || ''}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="مثال: طوب عالي الألومينا 70% - قياسي"
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-xs font-bold text-slate-900 focus:outline-none focus:border-amber-500 focus:bg-white"
                />
              </div>

              {/* Category and Alumina % */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">التصنيف (Category / Product Type)</label>
                  <input
                    type="text"
                    value={formData.category || formData.productTypeNameAr || formData.productTypeName || ''}
                    onChange={(e) => setFormData({ ...formData, category: e.target.value, isManualClassification: true })}
                    placeholder="طوب حراري / كتل كبس"
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2 text-xs text-slate-800"
                  />
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-xs font-bold text-slate-700">نسبة الألومينا (%)</label>
                    {manualOverrideAlumina && (
                      <span className="text-[10px] text-amber-700 font-bold">تعديل يدوي</span>
                    )}
                  </div>
                  <input
                    id="product-form-alumina-input"
                    type="number"
                    step="0.1"
                    min={0}
                    max={100}
                    value={formData.aluminaPercentage !== undefined && formData.aluminaPercentage !== null ? formData.aluminaPercentage : ''}
                    onChange={(e) => {
                      setManualOverrideAlumina(true);
                      const val = e.target.value;
                      setFormData({ ...formData, aluminaPercentage: val === '' ? null : Number(val) });
                    }}
                    placeholder="اختياري (0-100)"
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2 text-xs font-mono font-bold text-slate-900"
                  />
                </div>
              </div>

              {/* Piece Weight & Dimensions */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">وزن القطعة (كجم)</label>
                  <input
                    id="product-form-weight-input"
                    type="number"
                    step="0.01"
                    min={0.01}
                    value={formData.pieceWeight !== undefined && formData.pieceWeight !== null ? formData.pieceWeight : ''}
                    onChange={(e) => {
                      const val = e.target.value;
                      setFormData({ 
                        ...formData, 
                        pieceWeight: val === '' ? null : Number(val), 
                        pieceWeightKg: val === '' ? null : Number(val) 
                      });
                    }}
                    placeholder="مثال: 4.5"
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2 text-xs font-mono font-bold text-slate-900"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">الأبعاد (Dimensions)</label>
                  <input
                    type="text"
                    value={formData.dimensions || ''}
                    onChange={(e) => setFormData({ ...formData, dimensions: e.target.value })}
                    placeholder="230x114x65 مم"
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2 text-xs"
                  />
                </div>
              </div>
            </>
          )}

          {/* Common Code & Name for Other Entities */}
          {activeTab !== 'products' && activeTab !== 'productTypes' && (
            <>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  الكود التعريفي (Code) *
                </label>
                <input
                  type="text"
                  required
                  value={formData.code || ''}
                  onChange={(e) => setFormData({ ...formData, code: e.target.value })}
                  placeholder="مثال: EMP-101 / PRESS-01"
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-xs text-slate-800 focus:outline-none focus:border-amber-500 focus:bg-white"
                />
              </div>

              {activeTab !== 'furnaceCars' && (
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    الاسم / الوصف *
                  </label>
                  <input
                    type="text"
                    required
                    value={formData.name || ''}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    placeholder="أدخل الاسم بالعربية"
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-xs text-slate-800 focus:outline-none focus:border-amber-500 focus:bg-white"
                  />
                </div>
              )}
            </>
          )}

          {/* Specific Employee Fields */}
          {activeTab === 'employees' && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">المسمى الوظيفي</label>
                <input
                  type="text"
                  value={formData.jobTitle || ''}
                  onChange={(e) => setFormData({ ...formData, jobTitle: e.target.value })}
                  placeholder="فني مكبس / عامل فرن"
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2 text-xs"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">القسم</label>
                <select
                  value={formData.departmentId || ''}
                  onChange={(e) => {
                    const deptId = e.target.value;
                    const dept = departments.find((d) => d.id === deptId);
                    setFormData({
                      ...formData,
                      departmentId: deptId,
                      departmentName: dept?.name || '',
                    });
                  }}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2 text-xs"
                >
                  <option value="">-- اختر القسم --</option>
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}

          {/* Specific Presses Fields */}
          {activeTab === 'presses' && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">الحمولة (طن)</label>
                <input
                  type="number"
                  value={formData.tonnage ?? 1200}
                  onChange={(e) => setFormData({ ...formData, tonnage: Number(e.target.value) })}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2 text-xs"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">الموديل والصانع</label>
                <input
                  type="text"
                  value={formData.model || ''}
                  onChange={(e) => setFormData({ ...formData, model: e.target.value })}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2 text-xs"
                />
              </div>
            </div>
          )}

          {/* Specific Furnace Cars Fields */}
          {activeTab === 'furnaceCars' && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">رقم العربة *</label>
                <input
                  type="text"
                  required
                  value={formData.carNumber || ''}
                  onChange={(e) => setFormData({ ...formData, carNumber: e.target.value })}
                  placeholder="مثال: 105"
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2 text-xs"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">الفرن المخصص</label>
                <select
                  value={formData.furnaceId || ''}
                  onChange={(e) => {
                    const fId = e.target.value;
                    const furnace = furnaces.find((f) => f.id === fId);
                    setFormData({
                      ...formData,
                      furnaceId: fId,
                      furnaceName: furnace?.name || '',
                    });
                  }}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2 text-xs"
                >
                  <option value="">-- اختياري --</option>
                  {furnaces.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}

          {/* Form Actions */}
          <div className="flex items-center justify-end gap-2.5 pt-4 border-t border-slate-100">
            <button
              type="button"
              onClick={() => setIsModalOpen(false)}
              className="px-4 py-2 text-xs font-bold text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors cursor-pointer"
            >
              إلغاء
            </button>
            <button
              id="master-data-modal-save-btn"
              type="submit"
              disabled={isSaving || (activeTab === 'products' && liveProductParseResult?.isValid === false)}
              className="px-5 py-2 text-xs font-extrabold text-slate-950 bg-amber-400 hover:bg-amber-500 rounded-xl shadow-xs transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer flex items-center gap-2"
            >
              {isSaving && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
              <span>{editingItem ? 'حفظ التعديلات' : 'إضافة إلى قاعدة البيانات'}</span>
            </button>
          </div>
        </form>
      </Modal>

      {/* Quick Add Product Type Sub-Modal */}
      <Modal
        isOpen={isQuickTypeModalOpen}
        onClose={() => setIsQuickTypeModalOpen(false)}
        title={`إضافة تصنيف منتج جديد (${quickTypePrefix})`}
        subtitle="سيتم حفظ التصنيف في Firestore وإتاحته فوراً لمحلل الأكواد"
        maxWidth="md"
      >
        <form onSubmit={handleSaveQuickType} className="space-y-4">
          {quickTypeError && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-700 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{quickTypeError}</span>
            </div>
          )}

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              بادئة الكود (Prefix Code - 3 أحرف) *
            </label>
            <input
              type="text"
              maxLength={3}
              required
              value={quickTypePrefix}
              onChange={(e) => setQuickTypePrefix(e.target.value.toUpperCase())}
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm font-mono font-bold uppercase text-slate-900"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              الاسم بالإنجليزية (Name in English) *
            </label>
            <input
              type="text"
              required
              value={quickTypeNameEn}
              onChange={(e) => setQuickTypeNameEn(e.target.value)}
              placeholder="e.g. Bricks High Alumina Custom"
              dir="ltr"
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2 text-xs"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              الاسم بالعربية (Name in Arabic) *
            </label>
            <input
              type="text"
              required
              value={quickTypeNameAr}
              onChange={(e) => setQuickTypeNameAr(e.target.value)}
              placeholder="مثال: طوب عالي الألومينا مخصص"
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2 text-xs"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">الوصف</label>
            <textarea
              rows={2}
              value={quickTypeDescription}
              onChange={(e) => setQuickTypeDescription(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2 text-xs"
            />
          </div>

          <div className="flex items-center justify-end gap-2.5 pt-4 border-t border-slate-100">
            <button
              type="button"
              onClick={() => setIsQuickTypeModalOpen(false)}
              className="px-4 py-2 text-xs font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl"
            >
              إلغاء
            </button>
            <button
              type="submit"
              disabled={isQuickTypeSaving}
              className="px-5 py-2 text-xs font-extrabold text-slate-950 bg-amber-400 hover:bg-amber-500 rounded-xl flex items-center gap-2 cursor-pointer"
            >
              {isQuickTypeSaving && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
              <span>حفظ التصنيف وتفعيله فوراً</span>
            </button>
          </div>
        </form>
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal
        isOpen={!!deleteConfirmItem}
        onClose={() => setDeleteConfirmItem(null)}
        title="تأكيد الحذف"
        subtitle="هل أنت متأكد من رغبتك في حذف أو تعطيل هذا السجل؟"
        maxWidth="sm"
      >
        <div className="space-y-4">
          <p className="text-xs text-slate-600 leading-relaxed">
            سيتم إزالة السجل ({deleteConfirmItem?.code || deleteConfirmItem?.prefixCode || deleteConfirmItem?.name}) من قاعدة البيانات السحابية مباشرة.
          </p>
          <div className="flex items-center justify-end gap-2.5 pt-4 border-t border-slate-100">
            <button
              type="button"
              onClick={() => setDeleteConfirmItem(null)}
              className="px-4 py-2 text-xs font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl cursor-pointer"
            >
              إلغاء
            </button>
            <button
              id="confirm-delete-btn"
              type="button"
              onClick={handleDelete}
              className="px-4 py-2 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 rounded-xl shadow-xs cursor-pointer"
            >
              تأكيد الحذف
            </button>
          </div>
        </div>
      </Modal>

      {/* Analyze Existing Product Codes Modal */}
      <Modal
        isOpen={isAnalyzeModalOpen}
        onClose={() => setIsAnalyzeModalOpen(false)}
        title="تحليل الأكواد الحالية للمنتجات (Analyze Product Codes)"
        subtitle="فحص المنتجات المسجلة واستخراج الحقول المشتقة (البادئة، التصنيف، الألومينا، المعرف) دون التأثير على الأوزان أو الأبعاد أو حذف أي سجل"
        maxWidth="2xl"
      >
        <div className="space-y-4 text-xs">
          {analysisAppliedMessage && (
            <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-900 flex items-start gap-2">
              <Check className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
              <div>
                <p className="font-bold">اكتمل التحديث بنجاح!</p>
                <p className="text-[11px] mt-0.5">{analysisAppliedMessage}</p>
              </div>
            </div>
          )}

          {/* KPI Summary Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            <div className="bg-slate-50 border border-slate-200 p-3 rounded-xl text-center">
              <span className="block text-[11px] text-slate-500 font-medium">إجمالي المنتجات</span>
              <span className="text-base font-black text-slate-900">{analyzedItems.length}</span>
            </div>
            <div className="bg-amber-50 border border-amber-200 p-3 rounded-xl text-center">
              <span className="block text-[11px] text-amber-800 font-medium">جاهز للإثراء والتحديث</span>
              <span className="text-base font-black text-amber-900">
                {analyzedItems.filter((i) => i.needsUpdate && i.parseResult.isValid).length}
              </span>
            </div>
            <div className="bg-emerald-50 border border-emerald-200 p-3 rounded-xl text-center">
              <span className="block text-[11px] text-emerald-800 font-medium">مكتمل ومحدث مسبقاً</span>
              <span className="text-base font-black text-emerald-900">
                {analyzedItems.filter((i) => !i.needsUpdate && i.parseResult.isValid).length}
              </span>
            </div>
            <div className="bg-rose-50 border border-rose-200 p-3 rounded-xl text-center">
              <span className="block text-[11px] text-rose-800 font-medium">بادئة غير مسجلة أو غير صالحة</span>
              <span className="text-base font-black text-rose-900">
                {analyzedItems.filter((i) => !i.parseResult.isValid).length}
              </span>
            </div>
          </div>

          {/* Instruction Note */}
          <div className="p-3 bg-indigo-50/70 border border-indigo-200 rounded-xl text-indigo-950 flex items-start gap-2 leading-relaxed">
            <Sparkles className="w-4 h-4 text-indigo-600 shrink-0 mt-0.5" />
            <div>
              <p className="font-bold">التوافق والأمان مع البيانات السابقة (Backward Compatibility)</p>
              <p className="text-[11px] text-indigo-800 mt-0.5">
                يقوم هذا الفحص بمعاينة الحقول الذكية المشتقة تلقائياً من كود المنتج وربطها مع جدول تصنيفات المنتجات (Product Types). لن يتم تعديل وزن القطعة أو الأبعاد أو الحقول المخصصة، ولن يتم حذف أي سجل نهائياً.
              </p>
            </div>
          </div>

          {/* Analysis Comparison Preview Table */}
          <div className="border border-slate-200 rounded-xl overflow-hidden max-h-80 overflow-y-auto">
            <table className="w-full text-right text-xs">
              <thead className="bg-slate-100 text-slate-700 font-bold sticky top-0 border-b border-slate-200 z-10">
                <tr>
                  <th className="px-3 py-2.5">الكود</th>
                  <th className="px-3 py-2.5">الاسم الحالي</th>
                  <th className="px-3 py-2.5">البادئة المشتقة</th>
                  <th className="px-3 py-2.5">التصنيف المشتق</th>
                  <th className="px-3 py-2.5">الألومينا %</th>
                  <th className="px-3 py-2.5">المعرف</th>
                  <th className="px-3 py-2.5 text-center">الحالة</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {analyzedItems.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-slate-400">
                      لا توجد منتجات مسجلة في قاعدة البيانات حالياً.
                    </td>
                  </tr>
                ) : (
                  analyzedItems.map((item, idx) => (
                    <tr
                      key={item.product.id || idx}
                      className={`hover:bg-slate-50/80 ${
                        item.needsUpdate && item.parseResult.isValid
                          ? 'bg-amber-50/30'
                          : !item.parseResult.isValid
                          ? 'bg-rose-50/30'
                          : ''
                      }`}
                    >
                      <td className="px-3 py-2 font-mono font-bold text-slate-900">
                        {item.product.code || '-'}
                      </td>
                      <td className="px-3 py-2 font-medium text-slate-700 max-w-[140px] truncate">
                        {item.product.name}
                      </td>
                      <td className="px-3 py-2 font-mono font-bold">
                        {item.parseResult.prefix ? (
                          <span className="px-1.5 py-0.5 rounded bg-slate-900 text-amber-300 text-[10px]">
                            {item.parseResult.prefix}
                          </span>
                        ) : (
                          <span className="text-slate-400">-</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-[11px] text-slate-800">
                        {item.parseResult.productType ? (
                          <span>{item.parseResult.productType.nameAr || item.parseResult.productType.nameEn}</span>
                        ) : item.parseResult.isUnknownPrefix ? (
                          <span className="text-rose-600 font-bold">بادئة غير مسجلة ({item.parseResult.prefix})</span>
                        ) : (
                          <span className="text-slate-400">-</span>
                        )}
                      </td>
                      <td className="px-3 py-2 font-mono font-bold text-amber-700">
                        {item.parseResult.aluminaPercentage !== undefined
                          ? `${item.parseResult.aluminaPercentage}%`
                          : '-'}
                      </td>
                      <td className="px-3 py-2 font-mono text-slate-600">
                        {item.parseResult.productIdentifier || '-'}
                      </td>
                      <td className="px-3 py-2 text-center">
                        {item.needsUpdate && item.parseResult.isValid ? (
                          <Badge variant="warning">بحاجة إثراء ⚡</Badge>
                        ) : !item.parseResult.isValid ? (
                          <Badge variant="danger">مراجعة البادئة ⚠️</Badge>
                        ) : (
                          <Badge variant="success">محدث ✅</Badge>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Modal Action Controls */}
          <div className="flex items-center justify-between pt-3 border-t border-slate-100 flex-wrap gap-2">
            <span className="text-[11px] text-slate-500">
              عدد المنتجات المستهدفة بالتحديث: <strong className="text-slate-900">{analyzedItems.filter((i) => i.needsUpdate).length}</strong>
            </span>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setIsAnalyzeModalOpen(false)}
                className="px-4 py-2 text-xs font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors cursor-pointer"
              >
                إغلاق
              </button>

              <button
                id="apply-analysis-upgrade-btn"
                type="button"
                onClick={handleApplyAnalysis}
                disabled={isApplyingAnalysis || analyzedItems.filter((i) => i.needsUpdate).length === 0}
                className="px-5 py-2 text-xs font-extrabold text-slate-950 bg-amber-400 hover:bg-amber-500 rounded-xl shadow-xs transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 cursor-pointer"
              >
                {isApplyingAnalysis && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                <span>
                  تطبيق التحديث الذكي والتطبيع ({analyzedItems.filter((i) => i.needsUpdate).length} منتج)
                </span>
              </button>
            </div>
          </div>
        </div>
      </Modal>

      {/* Data Quality & Integrity Diagnostics Modal */}
      <DataQualityModal
        isOpen={isQualityModalOpen}
        onClose={() => setIsQualityModalOpen(false)}
      />
    </div>
  );
};

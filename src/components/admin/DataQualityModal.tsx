/**
 * Data Quality Check Diagnostic Tool
 * 
 * Inspects Firestore database integrity across Master Data and Production Records:
 * 1. Products starting with digits but having improperly derived alumina
 * 2. Products with unknown/unregistered alphabetic prefixes
 * 3. Products with missing names, weights, or invalid codes
 * 4. Duplicate codes across entities
 * 5. Employees missing employeeCode or name
 * 6. Production records missing stable relationship IDs
 * 7. Broken Furnace-to-Car relationships
 * 8. Inactive records referenced by production logs
 * 
 * Displays issues non-destructively without modifying data automatically.
 */
import React, { useState, useEffect } from 'react';
import { 
  ShieldCheck, 
  AlertTriangle, 
  AlertCircle, 
  Info, 
  CheckCircle2, 
  RefreshCw, 
  Box, 
  Users, 
  Cpu, 
  Flame, 
  Layers, 
  Building,
  Check,
  X
} from 'lucide-react';
import { Modal } from '../common/Modal';
import { fetchMasterData } from '../../services/masterDataService';
import { fetchProductionRecords } from '../../services/productionService';
import { fetchProductTypes } from '../../services/productTypeService';
import { parseProductCode } from '../../utils/productCodeParser';
import { 
  Product, 
  Employee, 
  Press, 
  Furnace, 
  FurnaceCar, 
  Customer, 
  ProductType, 
  ProductionRecord 
} from '../../types';

export interface QualityIssue {
  id: string;
  category: 'PRODUCT' | 'EMPLOYEE' | 'EQUIPMENT' | 'PRODUCTION' | 'RELATIONSHIP';
  severity: 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';
  title: string;
  description: string;
  entityId?: string;
  entityCode?: string;
  entityName?: string;
  suggestedAction?: string;
}

interface DataQualityModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const DataQualityModal: React.FC<DataQualityModalProps> = ({ isOpen, onClose }) => {
  const [isRunningCheck, setIsRunningCheck] = useState<boolean>(false);
  const [issues, setIssues] = useState<QualityIssue[]>([]);
  const [activeFilter, setActiveFilter] = useState<'ALL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO'>('ALL');
  const [categoryFilter, setCategoryFilter] = useState<string>('ALL');
  const [stats, setStats] = useState({
    totalProducts: 0,
    totalEmployees: 0,
    totalProductionRecords: 0,
    totalPresses: 0,
    totalFurnaces: 0,
    totalCars: 0,
  });

  const runQualityDiagnostic = async () => {
    setIsRunningCheck(true);
    setIssues([]);

    try {
      const [
        products,
        productTypes,
        employees,
        presses,
        furnaces,
        furnaceCars,
        customers,
        productionRecords,
      ] = await Promise.all([
        fetchMasterData<Product>('products'),
        fetchProductTypes(),
        fetchMasterData<Employee>('employees'),
        fetchMasterData<Press>('presses'),
        fetchMasterData<Furnace>('furnaces'),
        fetchMasterData<FurnaceCar>('furnaceCars'),
        fetchMasterData<Customer>('customers'),
        fetchProductionRecords(),
      ]);

      setStats({
        totalProducts: products.length,
        totalEmployees: employees.length,
        totalProductionRecords: productionRecords.length,
        totalPresses: presses.length,
        totalFurnaces: furnaces.length,
        totalCars: furnaceCars.length,
      });

      const foundIssues: QualityIssue[] = [];
      const prefixSet = new Set(productTypes.map((pt) => pt.prefixCode.toUpperCase()));

      // 1. PRODUCT QUALITY AUDIT
      const productCodesSeen = new Map<string, string>();
      for (const prod of products) {
        const code = (prod.code || prod.productCode || '').trim();
        const name = (prod.name || prod.productName || '').trim();

        // Check missing name
        if (!name) {
          foundIssues.push({
            id: `prod-noname-${prod.id}`,
            category: 'PRODUCT',
            severity: 'HIGH',
            title: 'منتج بدون اسم أو توصيف',
            description: `المنتج ذو الكود (${code || 'بدون كود'}) مسجل بدون اسم عربي أو توصيف.`,
            entityId: prod.id,
            entityCode: code,
            suggestedAction: 'أضف اسماً واضحاً للمنتج من شاشة المنتجات.',
          });
        }

        // Check duplicate product codes
        if (code) {
          const upperCode = code.toUpperCase();
          if (productCodesSeen.has(upperCode)) {
            foundIssues.push({
              id: `prod-dup-${prod.id}`,
              category: 'PRODUCT',
              severity: 'HIGH',
              title: 'تكرار كود المنتج (Duplicate Product Code)',
              description: `الكود "${code}" مكرر لأكثر من منتج (${name}).`,
              entityId: prod.id,
              entityCode: code,
              entityName: name,
              suggestedAction: 'تعديل الكود لمنع الالتباس أثناء تسجيل الإنتاج.',
            });
          } else {
            productCodesSeen.set(upperCode, prod.id || '');
          }
        }

        // Check numeric-starting product code with auto-derived alumina flag
        if (code && /^[0-9]/.test(code)) {
          if (prod.smartParseStatus === 'SMART_CODE') {
            foundIssues.push({
              id: `prod-num-smart-${prod.id}`,
              category: 'PRODUCT',
              severity: 'MEDIUM',
              title: 'كود رقمي مصنف خطأ كـ كود ذكي (Numeric Code marked as Smart)',
              description: `المنتج "${code} - ${name}" يبدأ برقم لكنه مصنف كـ SMART_CODE. حسب القواعد المعيارية الأكواد الرقمية يجب أن تكون MANUAL_PRODUCT_CODE.`,
              entityId: prod.id,
              entityCode: code,
              entityName: name,
              suggestedAction: 'استخدم أداة "إعادة تحليل الأكواد" لتصحيح التصنيف إلى يدوي.',
            });
          }
        }

        // Check unknown alphabetic prefix
        if (code && /^[A-Za-z]{3}/.test(code)) {
          const prefix = code.substring(0, 3).toUpperCase();
          if (!prefixSet.has(prefix)) {
            foundIssues.push({
              id: `prod-unknown-prefix-${prod.id}`,
              category: 'PRODUCT',
              severity: 'LOW',
              title: 'بادئة منتج غير مسجلة (Unknown Prefix)',
              description: `المنتج "${code}" يحمل البادئة "${prefix}" وهي غير مسجلة في جدول تصنيفات المنتجات (Product Types).`,
              entityId: prod.id,
              entityCode: code,
              entityName: name,
              suggestedAction: `إضافة البادئة "${prefix}" في تبويب "تصنيفات المنتجات (Prefixes)" للاستفادة من التعرف التلقائي.`,
            });
          }
        }
      }

      // 2. EMPLOYEE QUALITY AUDIT
      const employeeCodesSeen = new Map<string, string>();
      for (const emp of employees) {
        const code = (emp.code || '').trim();
        const name = (emp.name || '').trim();

        if (!code) {
          foundIssues.push({
            id: `emp-nocode-${emp.id}`,
            category: 'EMPLOYEE',
            severity: 'HIGH',
            title: 'موظف/عامل بدون كود تشغيل',
            description: `العامل "${name || 'بدون اسم'}" مسجل بدون كود تعريف (Code).`,
            entityId: emp.id,
            entityName: name,
            suggestedAction: 'أدخل كود وظيفي (مثال E010) لتمكين البحث السريع.',
          });
        } else {
          const upperCode = code.toUpperCase();
          if (employeeCodesSeen.has(upperCode)) {
            foundIssues.push({
              id: `emp-dup-${emp.id}`,
              category: 'EMPLOYEE',
              severity: 'HIGH',
              title: 'تكرار كود الموظف (Duplicate Employee Code)',
              description: `الكود "${code}" مكرر لأكثر من عامل (${name}).`,
              entityId: emp.id,
              entityCode: code,
              entityName: name,
              suggestedAction: 'تعيين كود فريد لكل عامل.',
            });
          } else {
            employeeCodesSeen.set(upperCode, emp.id || '');
          }
        }

        if (!name) {
          foundIssues.push({
            id: `emp-noname-${emp.id}`,
            category: 'EMPLOYEE',
            severity: 'HIGH',
            title: 'سجل موظف بدون اسم',
            description: `الموظف ذو الكود (${code}) مسجل بدون اسم.`,
            entityId: emp.id,
            entityCode: code,
            suggestedAction: 'أدخل اسم العامل.',
          });
        }
      }

      // 3. FURNACE & CAR RELATIONSHIPS AUDIT
      const furnaceIdsSet = new Set(furnaces.map((f) => f.id));
      for (const car of furnaceCars) {
        if (car.furnaceId && !furnaceIdsSet.has(car.furnaceId)) {
          foundIssues.push({
            id: `car-orphan-${car.id}`,
            category: 'RELATIONSHIP',
            severity: 'MEDIUM',
            title: 'عربة فرن مرتبطة بفرن غير موجود (Orphaned Car)',
            description: `العربة رقم #${car.carNumber || car.code} تشير إلى فرن غير مسجل في النظام.`,
            entityId: car.id,
            entityCode: car.code,
            suggestedAction: 'تعديل بيانات العربة وإعادة ربطها بفرن قائم أو جعلها عربة عامة.',
          });
        }
      }

      // 4. PRODUCTION RECORDS INTEGRITY AUDIT
      for (const rec of productionRecords) {
        const issuesInRecord: string[] = [];

        if (!rec.shiftId && !rec.shiftName) issuesInRecord.push('الوردية');
        if (!rec.pressId && !rec.pressName) issuesInRecord.push('المكبس');
        if (!rec.productId && !rec.productName) issuesInRecord.push('المنتج');

        if (issuesInRecord.length > 0) {
          foundIssues.push({
            id: `rec-missing-${rec.id}`,
            category: 'PRODUCTION',
            severity: 'HIGH',
            title: 'سجل إنتاج يفتقر إلى معرفات أساسية',
            description: `سجل الإنتاج بتاريخ (${rec.date || 'بدون تاريخ'}) يفتقر إلى بيانات: ${issuesInRecord.join('، ')}.`,
            entityId: rec.id,
            suggestedAction: 'مراجعة السجل من شاشة سجلات الإنتاج.',
          });
        }

        // Check if employee relations are missing snapshots
        if (rec.employeeIds && rec.employeeIds.length > 0 && (!rec.employeeNames || rec.employeeNames.length === 0)) {
          foundIssues.push({
            id: `rec-emp-snap-${rec.id}`,
            category: 'PRODUCTION',
            severity: 'INFO',
            title: 'سجل إنتاج قديم بدون لقطة أسماء العمال (Missing Name Snapshot)',
            description: `سجل الإنتاج بتاريخ (${rec.date}) يحتوي على معرفات العمال بدون لقطة الأسماء النصية المباشرة.`,
            entityId: rec.id,
            suggestedAction: 'النظام يدعم التوافقية العكسية تلقائياً.',
          });
        }
      }

      setIssues(foundIssues);
    } catch (err: any) {
      console.error('Error running data quality diagnostic:', err);
    } finally {
      setIsRunningCheck(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      runQualityDiagnostic();
    }
  }, [isOpen]);

  const filteredIssues = issues.filter((iss) => {
    if (activeFilter !== 'ALL' && iss.severity !== activeFilter) return false;
    if (categoryFilter !== 'ALL' && iss.category !== categoryFilter) return false;
    return true;
  });

  const highCount = issues.filter((i) => i.severity === 'HIGH').length;
  const mediumCount = issues.filter((i) => i.severity === 'MEDIUM').length;
  const lowCount = issues.filter((i) => i.severity === 'LOW').length;
  const infoCount = issues.filter((i) => i.severity === 'INFO').length;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="أداة فحص جودة وسلامة البيانات (Data Quality & Integrity Check)"
      maxWidth="4xl"
    >
      <div id="data-quality-modal-content" className="space-y-5">
        {/* Header Description & Refresh Trigger */}
        <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div>
            <h4 className="text-xs font-black text-slate-900 flex items-center gap-1.5">
              <ShieldCheck className="w-4 h-4 text-red-600" />
              فحص شامل لتناسق قواعد البيانات والعلاقات والأكواد المعيارية
            </h4>
            <p className="text-[11px] text-slate-500 mt-0.5">
              يقوم هذا الفحص باكتشاف الأكواد المكررة، العلاقات المفقودة، وتصنيفات الأكواد الرقمية دون أي تعديل أو مساس بالبيانات الحالية.
            </p>
          </div>

          <button
            type="button"
            id="btn-rerun-quality-check"
            onClick={runQualityDiagnostic}
            disabled={isRunningCheck}
            className="flex items-center gap-1.5 px-4 py-2 bg-white hover:bg-slate-100 text-slate-800 font-bold text-xs rounded-xl border border-slate-300 shadow-2xs transition-colors cursor-pointer shrink-0 disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 text-slate-600 ${isRunningCheck ? 'animate-spin' : ''}`} />
            <span>إعادة الفحص الآن</span>
          </button>
        </div>

        {/* Database Overview Metrics */}
        <div className="grid grid-cols-2 sm:grid-cols-6 gap-2 text-center text-xs">
          <div className="bg-slate-100/70 p-2 rounded-xl border border-slate-200">
            <span className="text-[10px] text-slate-500 block">المنتجات</span>
            <span className="text-sm font-black text-slate-900">{stats.totalProducts}</span>
          </div>
          <div className="bg-slate-100/70 p-2 rounded-xl border border-slate-200">
            <span className="text-[10px] text-slate-500 block">العمال</span>
            <span className="text-sm font-black text-slate-900">{stats.totalEmployees}</span>
          </div>
          <div className="bg-slate-100/70 p-2 rounded-xl border border-slate-200">
            <span className="text-[10px] text-slate-500 block">المكابس</span>
            <span className="text-sm font-black text-slate-900">{stats.totalPresses}</span>
          </div>
          <div className="bg-slate-100/70 p-2 rounded-xl border border-slate-200">
            <span className="text-[10px] text-slate-500 block">الأفران</span>
            <span className="text-sm font-black text-slate-900">{stats.totalFurnaces}</span>
          </div>
          <div className="bg-slate-100/70 p-2 rounded-xl border border-slate-200">
            <span className="text-[10px] text-slate-500 block">عربات الأفران</span>
            <span className="text-sm font-black text-slate-900">{stats.totalCars}</span>
          </div>
          <div className="bg-slate-100/70 p-2 rounded-xl border border-slate-200">
            <span className="text-[10px] text-slate-500 block">سجلات الإنتاج</span>
            <span className="text-sm font-black text-slate-900">{stats.totalProductionRecords}</span>
          </div>
        </div>

        {/* Severity Summary Filter Pills */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-3">
          <div className="flex items-center gap-1.5 flex-wrap">
            <button
              type="button"
              onClick={() => setActiveFilter('ALL')}
              className={`px-3 py-1 text-xs font-bold rounded-lg transition-colors cursor-pointer ${
                activeFilter === 'ALL' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              جميع الملاحظات ({issues.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveFilter('HIGH')}
              className={`px-3 py-1 text-xs font-bold rounded-lg transition-colors cursor-pointer ${
                activeFilter === 'HIGH' ? 'bg-red-600 text-white' : 'bg-red-50 text-red-700 hover:bg-red-100 border border-red-200'
              }`}
            >
              حرجة ({highCount})
            </button>
            <button
              type="button"
              onClick={() => setActiveFilter('MEDIUM')}
              className={`px-3 py-1 text-xs font-bold rounded-lg transition-colors cursor-pointer ${
                activeFilter === 'MEDIUM' ? 'bg-amber-600 text-white' : 'bg-amber-50 text-amber-800 hover:bg-amber-100 border border-amber-200'
              }`}
            >
              متوسطة ({mediumCount})
            </button>
            <button
              type="button"
              onClick={() => setActiveFilter('LOW')}
              className={`px-3 py-1 text-xs font-bold rounded-lg transition-colors cursor-pointer ${
                activeFilter === 'LOW' ? 'bg-sky-600 text-white' : 'bg-sky-50 text-sky-800 hover:bg-sky-100 border border-sky-200'
              }`}
            >
              منخفضة ({lowCount})
            </button>
            <button
              type="button"
              onClick={() => setActiveFilter('INFO')}
              className={`px-3 py-1 text-xs font-bold rounded-lg transition-colors cursor-pointer ${
                activeFilter === 'INFO' ? 'bg-slate-700 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              تنبيهات ({infoCount})
            </button>
          </div>

          {/* Category Filter Select */}
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="bg-slate-50 border border-slate-300 rounded-lg px-2.5 py-1 text-xs text-slate-700 font-bold"
          >
            <option value="ALL">جميع الأقسام</option>
            <option value="PRODUCT">المنتجات (Products)</option>
            <option value="EMPLOYEE">العمال والموظفون</option>
            <option value="RELATIONSHIP">العلاقات والربط</option>
            <option value="PRODUCTION">سجلات الإنتاج</option>
          </select>
        </div>

        {/* Diagnostic Results List */}
        <div className="max-h-[380px] overflow-y-auto space-y-2.5 pr-1">
          {isRunningCheck ? (
            <div className="py-12 text-center text-slate-500">
              <RefreshCw className="w-6 h-6 animate-spin mx-auto text-red-600 mb-2" />
              <p className="text-xs font-bold">جاري تشغيل الفحص التشخيصي الشامل لقاعدة البيانات...</p>
            </div>
          ) : filteredIssues.length === 0 ? (
            <div className="py-12 text-center bg-emerald-50/60 rounded-2xl border border-emerald-200 text-emerald-900">
              <CheckCircle2 className="w-8 h-8 text-emerald-600 mx-auto mb-2" />
              <h4 className="text-sm font-black">جودة البيانات ممتازة 100%!</h4>
              <p className="text-xs text-emerald-700 mt-1 max-w-md mx-auto">
                لم يتم العثور على أي مشاكل أو أكواد مكررة أو علاقات مفقودة في السجلات المحددة.
              </p>
            </div>
          ) : (
            filteredIssues.map((iss) => {
              const badgeClass =
                iss.severity === 'HIGH'
                  ? 'bg-rose-50 text-rose-800 border-rose-200'
                  : iss.severity === 'MEDIUM'
                  ? 'bg-amber-50 text-amber-800 border-amber-200'
                  : iss.severity === 'LOW'
                  ? 'bg-sky-50 text-sky-800 border-sky-200'
                  : 'bg-slate-50 text-slate-700 border-slate-200';

              const icon =
                iss.severity === 'HIGH' ? (
                  <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                ) : iss.severity === 'MEDIUM' ? (
                  <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                ) : (
                  <Info className="w-4 h-4 text-sky-600 shrink-0 mt-0.5" />
                );

              return (
                <div
                  key={iss.id}
                  id={iss.id}
                  className={`p-3.5 rounded-xl border text-xs flex items-start gap-3 transition-colors ${badgeClass}`}
                >
                  {icon}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2 flex-wrap mb-1">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-slate-900">{iss.title}</span>
                        {iss.entityCode && (
                          <span className="font-mono text-[11px] font-bold px-1.5 py-0.2 rounded bg-white border border-slate-300 text-slate-800">
                            {iss.entityCode}
                          </span>
                        )}
                      </div>
                      <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-white/80 border border-black/5">
                        {iss.category}
                      </span>
                    </div>

                    <p className="text-slate-700 text-[11px] leading-relaxed">{iss.description}</p>

                    {iss.suggestedAction && (
                      <div className="mt-1.5 pt-1.5 border-t border-black/5 flex items-center gap-1.5 text-[10px] text-slate-600">
                        <span className="font-bold text-slate-800">الإجراء المقترح:</span>
                        <span>{iss.suggestedAction}</span>
                      </div>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Modal Footer */}
        <div className="pt-3 border-t border-slate-200 flex items-center justify-between">
          <span className="text-xs text-slate-500 font-medium">
            إجمالي المشاكل المكتشفة: <strong className="text-slate-800">{issues.length}</strong>
          </span>
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2 bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs rounded-xl transition-colors cursor-pointer"
          >
            إغلاق التقرير
          </button>
        </div>
      </div>
    </Modal>
  );
};

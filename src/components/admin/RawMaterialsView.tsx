/**
 * Raw Materials & Master Inventory Management View
 * Features:
 * - List materials with code, name, unit, current stock, reorder level, and unit cost
 * - Real-time stock status (Normal, Low, Critical alert)
 * - Add/Edit Material Modal
 * - Search by code or Arabic name
 */
import React, { useState, useEffect } from 'react';
import { 
  Package, 
  Plus, 
  Search, 
  Edit2, 
  Trash2, 
  AlertTriangle, 
  CheckCircle2, 
  DollarSign, 
  Scale, 
  Loader2,
  X,
  Save
} from 'lucide-react';
import { Material } from '../../types';
import { fetchMaterials, createMaterial, updateMaterial, deleteMaterial } from '../../services/materialService';

export const RawMaterialsView: React.FC = () => {
  const [materials, setMaterials] = useState<Material[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [searchQuery, setSearchQuery] = useState('');
  
  // Modal State
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [editingMaterial, setEditingMaterial] = useState<Material | null>(null);
  
  // Form State
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [unit, setUnit] = useState('طن');
  const [density, setDensity] = useState<number>(2.2);
  const [currentStock, setCurrentStock] = useState<number>(100);
  const [reorderLevel, setReorderLevel] = useState<number>(20);
  const [costPerUnit, setCostPerUnit] = useState<number>(1500);
  const [notes, setNotes] = useState('');
  const [isSaving, setIsSaving] = useState<boolean>(false);

  const loadMaterials = async () => {
    setIsLoading(true);
    try {
      const list = await fetchMaterials();
      setMaterials(list);
    } catch (e) {
      console.error(e);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadMaterials();
  }, []);

  const handleOpenAddModal = () => {
    setEditingMaterial(null);
    setCode(`MAT-${Date.now().toString().slice(-4)}`);
    setName('');
    setUnit('طن');
    setDensity(2.2);
    setCurrentStock(50);
    setReorderLevel(15);
    setCostPerUnit(1200);
    setNotes('');
    setIsModalOpen(true);
  };

  const handleOpenEditModal = (mat: Material) => {
    setEditingMaterial(mat);
    setCode(mat.code);
    setName(mat.name);
    setUnit(mat.unit || 'طن');
    setDensity(mat.density || 2.2);
    setCurrentStock(mat.currentStock || 0);
    setReorderLevel(mat.reorderLevel || 10);
    setCostPerUnit(mat.costPerUnit || 0);
    setNotes(mat.notes || '');
    setIsModalOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !code.trim()) return;

    setIsSaving(true);
    try {
      if (editingMaterial && editingMaterial.id) {
        await updateMaterial(editingMaterial.id, {
          code,
          name,
          unit,
          density,
          currentStock,
          reorderLevel,
          costPerUnit,
          notes,
        });
      } else {
        await createMaterial({
          code,
          name,
          unit,
          density,
          currentStock,
          reorderLevel,
          costPerUnit,
          notes,
          active: true,
        });
      }
      setIsModalOpen(false);
      await loadMaterials();
    } catch (e: any) {
      alert('فشل حفظ المادة الخام: ' + (e.message || ''));
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (id: string, matName: string) => {
    if (!window.confirm(`هل أنت متأكد من حذف المادة الخام: "${matName}"؟`)) return;
    try {
      await deleteMaterial(id);
      await loadMaterials();
    } catch (e: any) {
      alert('فشل الحذف: ' + e.message);
    }
  };

  const filteredMaterials = materials.filter(m => 
    m.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    m.code.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="space-y-6" dir="rtl">
      {/* Header */}
      <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-black text-slate-900 flex items-center gap-2">
            <Package className="w-6 h-6 text-purple-600" />
            إدارة الخامات والمواد الأولية (Raw Materials Master Data)
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            تعريف أنواع الطين والشاموت والسيليكا والأسمنت الحراري ومتابعة أرصدة المخزون
          </p>
        </div>

        <button
          type="button"
          onClick={handleOpenAddModal}
          className="flex items-center gap-1.5 px-4 py-2.5 text-xs font-bold text-white bg-purple-600 hover:bg-purple-700 rounded-xl shadow-xs transition-colors cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          إضافة مادة خام جديدة
        </button>
      </div>

      {/* Search Bar */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs">
        <div className="relative">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="بحث بكود المادة أو اسمها..."
            className="w-full pl-3 pr-9 py-2 text-xs bg-slate-50 border border-slate-300 rounded-xl focus:ring-2 focus:ring-purple-500/20 outline-none font-bold"
          />
          <Search className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2" />
        </div>
      </div>

      {/* Materials Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        {isLoading ? (
          <div className="p-12 text-center text-slate-500 text-sm flex flex-col items-center justify-center gap-3">
            <Loader2 className="w-8 h-8 animate-spin text-purple-600" />
            <span>جاري تحميل قائمة الخامات...</span>
          </div>
        ) : filteredMaterials.length === 0 ? (
          <div className="p-12 text-center text-slate-500 text-sm">
            لا توجد مواد خام مسجلة. اضغط "إضافة مادة خام جديدة" لإضافة أول مادة.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-right text-xs">
              <thead className="bg-slate-50 text-slate-600 font-bold border-b border-slate-200 uppercase">
                <tr>
                  <th className="px-4 py-3.5">الكود</th>
                  <th className="px-4 py-3.5">اسم المادة الخام</th>
                  <th className="px-4 py-3.5">وحدة القياس</th>
                  <th className="px-4 py-3.5">الرصيد الحالي</th>
                  <th className="px-4 py-3.5">حد الطلب الأدنى</th>
                  <th className="px-4 py-3.5">سعر الوحدة</th>
                  <th className="px-4 py-3.5 text-center">إجراءات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredMaterials.map((mat) => {
                  const isLow = (mat.currentStock || 0) <= (mat.reorderLevel || 0);
                  return (
                    <tr key={mat.id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="px-4 py-3 font-mono font-bold text-purple-700 whitespace-nowrap">
                        {mat.code}
                      </td>
                      <td className="px-4 py-3 font-bold text-slate-900">
                        {mat.name}
                      </td>
                      <td className="px-4 py-3 font-semibold text-slate-600">
                        {mat.unit}
                      </td>
                      <td className="px-4 py-3 font-mono font-bold whitespace-nowrap">
                        <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold ${
                          isLow ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                        }`}>
                          {isLow && <AlertTriangle className="w-3 h-3" />}
                          {(mat.currentStock || 0).toLocaleString()} {mat.unit}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-mono text-slate-600">
                        {(mat.reorderLevel || 0).toLocaleString()} {mat.unit}
                      </td>
                      <td className="px-4 py-3 font-mono font-bold text-slate-800">
                        {(mat.costPerUnit || 0).toLocaleString()} ج.م
                      </td>
                      <td className="px-4 py-3 text-center whitespace-nowrap">
                        <div className="flex items-center justify-center gap-1">
                          <button
                            type="button"
                            onClick={() => handleOpenEditModal(mat)}
                            className="p-1.5 text-slate-400 hover:text-purple-600 rounded-lg hover:bg-purple-50 cursor-pointer"
                          >
                            <Edit2 className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDelete(mat.id!, mat.name)}
                            className="p-1.5 text-slate-400 hover:text-red-600 rounded-lg hover:bg-red-50 cursor-pointer"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
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

      {/* Add / Edit Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-lg overflow-hidden">
            <div className="p-4 sm:p-5 border-b border-slate-100 flex items-center justify-between bg-slate-50">
              <h2 className="text-base font-black text-slate-900 flex items-center gap-2">
                <Package className="w-5 h-5 text-purple-600" />
                {editingMaterial ? 'تعديل بيانات مادة خام' : 'إضافة مادة خام جديدة'}
              </h2>
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-200 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSave} className="p-5 space-y-4 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">كود المادة *</label>
                  <input
                    type="text"
                    required
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg font-mono font-bold"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">وحدة القياس *</label>
                  <select
                    value={unit}
                    onChange={(e) => setUnit(e.target.value)}
                    className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg font-bold"
                  >
                    <option value="طن">طن (Ton)</option>
                    <option value="كجم">كجم (Kg)</option>
                    <option value="م3">متر مكعب (m³)</option>
                    <option value="لتر">لتر (Litre)</option>
                    <option value="شكارة">شكارة (Bag)</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">اسم المادة الخام (بالعربي) *</label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="مثال: شاموت أسواني درجة أولى 45%"
                  className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg font-bold"
                />
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">الرصيد الحالي</label>
                  <input
                    type="number"
                    step="0.1"
                    value={currentStock}
                    onChange={(e) => setCurrentStock(Number(e.target.value))}
                    className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg font-bold"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">حد الطلب الأدنى</label>
                  <input
                    type="number"
                    step="0.1"
                    value={reorderLevel}
                    onChange={(e) => setReorderLevel(Number(e.target.value))}
                    className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg font-bold text-red-600"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">سعر الوحدة (ج.م)</label>
                  <input
                    type="number"
                    step="1"
                    value={costPerUnit}
                    onChange={(e) => setCostPerUnit(Number(e.target.value))}
                    className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg font-bold"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-4 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 text-slate-600 font-bold hover:bg-slate-100 rounded-xl cursor-pointer"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={isSaving}
                  className="flex items-center gap-1.5 px-5 py-2 bg-purple-600 hover:bg-purple-700 text-white font-bold rounded-xl shadow-xs cursor-pointer"
                >
                  {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  حفظ البيانات
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

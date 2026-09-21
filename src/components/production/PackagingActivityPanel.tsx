/**
 * Packing sub-activity - Phase 1 Step 8C-5.
 *
 * Shown only for the lines that pack their own output (packagingActivityPure's
 * PACKAGING_APPLICABLE_STAGES). Optional and collapsed by default: leaving it
 * empty records no packing. Saved with the stage form in its single write.
 */
import React, { useState } from 'react';
import { Package, ChevronDown, ChevronUp } from 'lucide-react';
import type { PackagingActivity } from '../../types';
import { BOM_UNITS } from '../../services/bomPure';
import { useLanguage } from '../../i18n/LanguageContext';

interface Props {
  value: PackagingActivity | null;
  onChange: (value: PackagingActivity | null) => void;
}

const numberOrNull = (v: string): number | null => (v.trim() === '' ? null : Number(v));

export const PackagingActivityPanel: React.FC<Props> = ({ value, onChange }) => {
  const { language, isRtl } = useLanguage();
  const isAr = language === 'ar';
  const [open, setOpen] = useState(false);
  const p = value ?? {};
  const set = (patch: Partial<PackagingActivity>) => onChange({ ...p, ...patch });
  const input = 'w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-xl';

  return (
    <div id="packaging-activity-panel" className="bg-white rounded-2xl border border-slate-200 shadow-sm" dir={isRtl ? 'rtl' : 'ltr'}>
      <button type="button" onClick={() => setOpen((o) => !o)} className="w-full flex items-center justify-between px-4 py-3 cursor-pointer">
        <span className="flex items-center gap-2 text-sm font-bold text-slate-800">
          <Package className="w-4 h-4 text-sky-600" />
          {isAr ? 'التعبئة والتغليف (نشاط فرعي - اختياري)' : 'Packing (sub-activity - optional)'}
        </span>
        {open ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
      </button>
      {open && (
        <div className="px-4 pb-4 space-y-3">
          <p className="text-[11px] text-slate-500">
            {isAr
              ? 'تُحفظ مع سجل هذه المرحلة. الكميات تُسجل بوحدتها ولا تُحوَّل. اتركها فارغة إذا لم تتم تعبئة.'
              : 'Saved with this stage record. Quantities keep their own unit and are never converted. Leave empty when nothing was packed.'}
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <label className="text-xs font-bold text-slate-700">
              {isAr ? 'الكمية المعبأة' : 'Packed quantity'}
              <input id="packaging-packed-quantity" type="number" min="0" step="any" value={p.packedQuantity ?? ''} onChange={(e) => set({ packedQuantity: numberOrNull(e.target.value) })} className={input} />
            </label>
            <label className="text-xs font-bold text-slate-700">
              {isAr ? 'وحدة الكمية' : 'Quantity unit'}
              <select value={p.packedUnit ?? ''} onChange={(e) => set({ packedUnit: e.target.value || null })} className={input}>
                <option value="">-</option>
                {BOM_UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
              </select>
            </label>
            <label className="text-xs font-bold text-slate-700">
              {isAr ? 'عدد العبوات' : 'Package count'}
              <input id="packaging-package-count" type="number" min="0" step="1" value={p.packageCount ?? ''} onChange={(e) => set({ packageCount: numberOrNull(e.target.value) })} className={input} />
            </label>
            <label className="text-xs font-bold text-slate-700">
              {isAr ? 'وحدة العبوة' : 'Package unit'}
              <select value={p.packageUnit ?? ''} onChange={(e) => set({ packageUnit: e.target.value || null })} className={input}>
                <option value="">-</option>
                {BOM_UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
              </select>
            </label>
          </div>
          <label className="block text-xs font-bold text-slate-700">
            {isAr ? 'ملاحظات التعبئة' : 'Packing notes'}
            <input type="text" value={p.notes ?? ''} onChange={(e) => set({ notes: e.target.value })} className={input} />
          </label>
        </div>
      )}
    </div>
  );
};

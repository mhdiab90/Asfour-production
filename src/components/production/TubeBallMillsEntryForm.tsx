/**
 * Stage 4: Tube & Ball Mills Entry Form (طواحين الأنابيب والكرات)
 * Fields:
 * - Date, Mill Type (طاحونة كرات / أنابيب), Raw Material Type
 * - Operating Hours, Tons per Hour, Storage Bunker (البنكر / الصومعة)
 * - Auto-calculated Total Tons
 *
 * This stage's real record type (`TubeBallMillsRecord`, types/index.ts) has
 * no Product/Employee/Shift/Material master-data relationship and no waste
 * field - unlike the other 7 stages. Per the "do not invent missing stage
 * data" rule, no Master Data pickers, Shift field, or waste input were
 * added here; only the GENERIC improvements this stage's real schema can
 * actually receive (clean empty-start, full reset-on-save, shared warning
 * engine wired but naturally inert here since there's no waste concept to
 * warn about) are applied.
 */
import React, { useEffect, useState } from 'react';
import { Layers, Save, CheckCircle2, AlertCircle, Loader2, FileCheck } from 'lucide-react';
import { createStageRecord } from '../../services/stageRecordService';
// Phase 1 Step 5A: optional job / batch / operation references, validated before the existing write.
import { attachProductionReferences } from '../../services/productionReferenceService';
import type { ProductionReferenceSelection } from '../../services/productionReferencePure';
// Phase 1 Step 6: inputs (actual consumption from the entry screen) and outputs, validated before the existing write.
import { prepareActualConsumption } from '../../services/actualConsumptionService';
import { fetchMasterData } from '../../services/masterDataService';
// Phase 1 Step 6: production outputs + input batches (genealogy), validated before the existing write.
import { prepareProductionGenealogy } from '../../services/productionGenealogyService';
// Phase 1 Step 8C-5: the packing sub-activity, validated before the existing write.
import { preparePackagingActivity } from '../../services/packagingActivityService';
import type { ProductionGenealogySelection } from '../../services/productionGenealogyPure';
import { useLanguage } from '../../i18n/LanguageContext';
import { evaluateStageWarnings } from '../../utils/stageValidationEngine';
import { ValidationResult } from '../../utils/businessValidationRules';
import { useAuth } from '../../context/AuthContext';
import { Modal } from '../common/Modal';
import { logAuditAction } from '../../services/auditService';

export const TubeBallMillsEntryForm: React.FC<{ onSuccess?: () => void; productionReferences?: ProductionReferenceSelection; productionGenealogy?: ProductionGenealogySelection }> = ({ onSuccess, productionReferences, productionGenealogy }) => {
  const { language, isRtl } = useLanguage();
  const { isSuperAdmin, hasPermission } = useAuth();
  const canOverrideWarnings = isSuperAdmin || hasPermission('validation.overrideWarnings');

  const tr = {
    millTypePlaceholder: language === 'ar' ? 'مثال: طاحونة كرات 1' : 'e.g. Ball Mill #1',
    rawMaterialPlaceholder: language === 'ar' ? 'مثال: شاموت 45%' : 'e.g. Chamotte 45%',
    bunkerPlaceholder: language === 'ar' ? 'مثال: صومعة 4' : 'e.g. Silo / Bunker #4',
    savedSuccess: language === 'ar' ? 'تم حفظ سجل طواحين الأنابيب والكرات بنجاح.' : 'Tube & Ball Mills record saved successfully.',
    saveFailed: language === 'ar' ? 'فشل الحفظ.' : 'Save failed.',
    stageTitle: language === 'ar' ? 'تسجيل إنتاج: طواحين الأنابيب والكرات (Tube & Ball Mills)' : 'Production Entry: Tube & Ball Mills',
    stageSubtitle: language === 'ar' ? 'طحن الخامات بالكرات الفولاذية، الصوامع والبناكر، وساعات التشغيل' : 'Steel-ball grinding, silos & bunkers, and operating hours',
    stage4: language === 'ar' ? 'المرحلة 4' : 'Stage 4',
    operationDate: language === 'ar' ? 'تاريخ التشغيل' : 'Operation Date',
    millType: language === 'ar' ? 'نوع الطاحونة' : 'Mill Type',
    rawMaterialType: language === 'ar' ? 'نوع الخامة المطحونة' : 'Ground Raw Material Type',
    operatingHours: language === 'ar' ? 'ساعات التشغيل' : 'Operating Hours',
    tonsPerHourRate: language === 'ar' ? 'معدل الطن / ساعة' : 'Tons / Hour Rate',
    receivingBunker: language === 'ar' ? 'الصومعة / البنكر المستقبل' : 'Receiving Silo / Bunker',
    calculatedTotal: language === 'ar' ? 'إجمالي الإنتاج المحسوب' : 'Calculated Total Production',
    ton: language === 'ar' ? 'طن' : 't',
    notesLabel: language === 'ar' ? 'ملاحظات' : 'Notes',
    saveDraft: language === 'ar' ? 'حفظ كمسودة' : 'Save as Draft',
    approveAndSave: language === 'ar' ? 'اعتماد وتسجيل الإنتاج' : 'Approve & Save Production',
    saving: language === 'ar' ? 'جاري الحفظ...' : 'Saving...',
    warningsTitle: (n: number) => language === 'ar' ? `⚠️ ${n > 1 ? 'تحذيرات' : 'تحذير'}` : `⚠️ ${n > 1 ? 'Warnings' : 'Warning'}`,
    stillValidNote: language === 'ar' ? 'السجل يبقى صالحًا من الناحية الفنية ويمكن حفظه كما هو دون أي تعديل على القيم المدخلة.' : 'The record remains technically valid and can be saved as-is without altering any entered values.',
    noOverridePermission: language === 'ar' ? 'لا تملك صلاحية "حفظ رغم التحذير" - يمكنك تعديل البيانات فقط.' : 'You do not have "Save Despite Warning" permission - you may only edit the data.',
    editData: language === 'ar' ? 'تعديل البيانات' : 'Edit Data',
    saveDespiteWarning: language === 'ar' ? 'حفظ رغم التحذير' : 'Save Despite Warning',
  };

  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [millType, setMillType] = useState('');
  /** Phase 1 Step 8C: the mill and bunker from their existing masters; the free text is kept. */
  const [tubeBallMillId, setTubeBallMillId] = useState('');
  const [bunkerId, setBunkerId] = useState('');
  const [millOptions, setMillOptions] = useState<any[]>([]);
  const [bunkerOptions, setBunkerOptions] = useState<any[]>([]);

  useEffect(() => {
    Promise.all([
      fetchMasterData<any>('tubeBallMills').catch(() => []),
      fetchMasterData<any>('bunkers').catch(() => []),
    ]).then(([mills, bunkers]) => {
      setMillOptions((mills ?? []).filter((m: any) => m.active !== false));
      setBunkerOptions((bunkers ?? []).filter((b: any) => b.active !== false));
    }).catch(console.error);
  }, []);
  const [rawMaterialType, setRawMaterialType] = useState('');
  const [operatingHours, setOperatingHours] = useState<number>(0);
  const [tonsPerHour, setTonsPerHour] = useState<number>(0);
  const [storageBunker, setStorageBunker] = useState('');
  const [notes, setNotes] = useState('');

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [pendingWarnings, setPendingWarnings] = useState<ValidationResult[]>([]);

  const totalTons = Number((operatingHours * tonsPerHour).toFixed(2));

  const resetForm = () => {
    setDate(new Date().toISOString().split('T')[0]);
    setMillType('');
    setRawMaterialType('');
    setOperatingHours(0);
    setTonsPerHour(0);
    setStorageBunker('');
    setNotes('');
  };

  const handleSubmit = async (e: React.FormEvent, status: 'SUBMITTED' | 'DRAFT' = 'SUBMITTED') => {
    e.preventDefault();
    if (status === 'SUBMITTED') {
      const warnings = evaluateStageWarnings('tube_ball_mills', { production: totalTons }, language);
      if (warnings.length > 0) {
        setPendingWarnings(warnings);
        return;
      }
    }
    await performSave(status, []);
  };

  const performSave = async (status: 'SUBMITTED' | 'DRAFT', overriddenWarnings: ValidationResult[]) => {
    setIsSubmitting(true);
    setFeedback(null);
    try {
      // Inputs and outputs are validated and normalised BEFORE the existing write; invalid lines throw and nothing is written.
      const genealogyInputs = productionGenealogy?.inputs ?? [];
      const genealogy = await prepareProductionGenealogy(genealogyInputs, productionGenealogy?.outputs ?? [], productionReferences, language);
      const consumptionLines = await prepareActualConsumption(genealogyInputs, language);
      // References are validated and merged BEFORE the existing write; an invalid traced selection throws and nothing is written.
      const newRecordId = await createStageRecord('tube_ball_mills', await attachProductionReferences('tube_ball_mills', {
        date,
        ...(consumptionLines.length ? { materials: consumptionLines } : {}),
        ...genealogy,
        ...(await preparePackagingActivity('tube_ball_mills', productionGenealogy?.packaging, language)),
        millType,
        // Step 8C: the equipment master ids, beside the free text they never replace.
        ...(tubeBallMillId ? { tubeBallMillId } : {}),
        ...(bunkerId ? { bunkerId } : {}),
        rawMaterialType,
        operatingHours,
        tonsPerHour,
        storageBunker,
        totalTons,
        notes,
      }, productionReferences, language), status);

      if (overriddenWarnings.length > 0) {
        logAuditAction(
          'UPDATE',
          'stage_tube_ball_mills',
          newRecordId,
          `[OVERRIDE_WARNING] recordId=${newRecordId} warningCodes=${overriddenWarnings.map((w) => w.code).join(',')} override=true - ${overriddenWarnings.map((w) => w.message).join(' | ')}`
        ).catch(() => {});
      }

      setFeedback({ type: 'success', message: tr.savedSuccess });
      resetForm();
      setPendingWarnings([]);
      if (onSuccess) onSuccess();
    } catch (err: any) {
      setFeedback({ type: 'error', message: err.message || tr.saveFailed });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={(e) => handleSubmit(e, 'SUBMITTED')} className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 sm:p-7 space-y-6" dir={isRtl ? 'rtl' : 'ltr'}>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-slate-100 gap-3">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center">
            <Layers className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-slate-900">{tr.stageTitle}</h2>
            <p className="text-xs text-slate-500">{tr.stageSubtitle}</p>
          </div>
        </div>
        <span className="self-start sm:self-auto text-xs font-bold px-3 py-1 bg-purple-100 text-purple-800 rounded-lg">{tr.stage4}</span>
      </div>

      {feedback && (
        <div className={`p-4 rounded-xl text-xs font-bold flex items-center gap-2 ${feedback.type === 'success' ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-red-50 text-red-800 border border-red-200'}`}>
          {feedback.type === 'success' ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <AlertCircle className="w-4 h-4 shrink-0" />}
          <span>{feedback.message}</span>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <div>
          <label className="block text-xs font-bold text-slate-700 mb-1.5">{tr.operationDate} <span className="text-red-500">*</span></label>
          <input type="date" required value={date} onChange={(e) => setDate(e.target.value)} className="w-full px-3.5 py-2.5 text-sm bg-white border border-slate-300 rounded-xl focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500 outline-none" />
        </div>

        <div>
          <label className="block text-xs font-bold text-slate-700 mb-1.5">{tr.millType}</label>
          {/* Step 8C: the machine itself, from the existing master - the free text below stays for historical wording */}
          <select value={tubeBallMillId} onChange={(e) => setTubeBallMillId(e.target.value)} className="w-full px-3.5 py-2 text-sm bg-white border border-slate-300 rounded-xl mb-1.5">
            <option value="">{language === 'ar' ? '- اختر الطاحونة من البيانات الأساسية -' : '- select the mill from Master Data -'}</option>
            {millOptions.map((m: any) => <option key={m.id} value={m.id}>{[m.code, m.name].filter(Boolean).join(' - ')}</option>)}
          </select>
          <input type="text" value={millType} onChange={(e) => setMillType(e.target.value)} placeholder={tr.millTypePlaceholder} className="w-full px-3.5 py-2.5 text-sm bg-white border border-slate-300 rounded-xl focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500 outline-none" />
        </div>

        <div>
          <label className="block text-xs font-bold text-slate-700 mb-1.5">{tr.rawMaterialType}</label>
          <input type="text" value={rawMaterialType} onChange={(e) => setRawMaterialType(e.target.value)} placeholder={tr.rawMaterialPlaceholder} className="w-full px-3.5 py-2.5 text-sm bg-white border border-slate-300 rounded-xl focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500 outline-none" />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 bg-slate-50 p-4 rounded-xl border border-slate-200">
        <div>
          <label className="block text-xs font-bold text-slate-700 mb-1.5">{tr.operatingHours}</label>
          <input type="number" step="0.5" value={operatingHours || ''} onChange={(e) => setOperatingHours(Number(e.target.value) || 0)} placeholder="0" className="w-full px-3.5 py-2.5 text-sm bg-white border border-slate-300 rounded-xl font-bold" />
        </div>

        <div>
          <label className="block text-xs font-bold text-slate-700 mb-1.5">{tr.tonsPerHourRate}</label>
          <input type="number" step="0.1" value={tonsPerHour || ''} onChange={(e) => setTonsPerHour(Number(e.target.value) || 0)} placeholder="0" className="w-full px-3.5 py-2.5 text-sm bg-white border border-slate-300 rounded-xl font-bold" />
        </div>

        <div>
          <label className="block text-xs font-bold text-slate-700 mb-1.5">{tr.receivingBunker}</label>
          {/* Step 8C: the bunker itself, from the existing master - the free text below stays for historical wording */}
          <select value={bunkerId} onChange={(e) => setBunkerId(e.target.value)} className="w-full px-3.5 py-2 text-sm bg-white border border-slate-300 rounded-xl mb-1.5">
            <option value="">{language === 'ar' ? '- اختر البنكر من البيانات الأساسية -' : '- select the bunker from Master Data -'}</option>
            {bunkerOptions.map((b: any) => <option key={b.id} value={b.id}>{[b.code, b.bunkerNumber, b.name].filter(Boolean).join(' - ')}</option>)}
          </select>
          <input type="text" value={storageBunker} onChange={(e) => setStorageBunker(e.target.value)} placeholder={tr.bunkerPlaceholder} className="w-full px-3.5 py-2.5 text-sm bg-white border border-slate-300 rounded-xl font-bold" />
        </div>
      </div>

      <div className="bg-purple-50 p-4 rounded-xl border border-purple-200 text-center">
        <span className="text-xs text-purple-800 font-bold block">{tr.calculatedTotal}</span>
        <span className="text-2xl font-black text-purple-900 block mt-1">{totalTons} {tr.ton}</span>
      </div>

      <div>
        <label className="block text-xs font-bold text-slate-700 mb-1.5">{tr.notesLabel}</label>
        <input type="text" value={notes} onChange={(e) => setNotes(e.target.value)} className="w-full px-3.5 py-2.5 text-sm bg-white border border-slate-300 rounded-xl focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500 outline-none" />
      </div>

      <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100">
        <button type="button" disabled={isSubmitting} onClick={(e) => handleSubmit(e, 'DRAFT')} className="flex items-center gap-1.5 px-4 py-2.5 text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl cursor-pointer">
          <FileCheck className="w-4 h-4 text-slate-500" />
          {tr.saveDraft}
        </button>

        <button type="submit" disabled={isSubmitting} className="flex items-center gap-2 px-6 py-2.5 text-xs font-bold text-white bg-purple-600 hover:bg-purple-700 disabled:opacity-50 rounded-xl shadow-md transition-all cursor-pointer">
          {isSubmitting ? <><Loader2 className="w-4 h-4 animate-spin" />{tr.saving}</> : <><Save className="w-4 h-4" />{tr.approveAndSave}</>}
        </button>
      </div>

      {pendingWarnings.length > 0 && (
        <Modal isOpen onClose={() => setPendingWarnings([])} title={tr.warningsTitle(pendingWarnings.length)} maxWidth="md">
          <div className="space-y-3" dir={isRtl ? 'rtl' : 'ltr'}>
            <div className="p-3 bg-amber-50 border-2 border-amber-300 rounded-xl">
              <ul className="list-disc pr-5 text-sm font-bold text-amber-900 space-y-1">
                {pendingWarnings.map((w, idx) => <li key={idx}>{w.message}</li>)}
              </ul>
              <p className="text-[11px] text-amber-700 mt-2">{tr.stillValidNote}</p>
            </div>
            {!canOverrideWarnings && <p className="text-[11px] text-red-600 font-bold bg-red-50 border border-red-200 rounded-lg p-2">{tr.noOverridePermission}</p>}
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
              <button type="button" onClick={() => setPendingWarnings([])} className="px-4 py-2 text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer">{tr.editData}</button>
              <button type="button" disabled={!canOverrideWarnings || isSubmitting} onClick={() => performSave('SUBMITTED', pendingWarnings)} className="px-4 py-2 text-xs font-black text-white bg-amber-600 hover:bg-amber-700 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg cursor-pointer">
                {tr.saveDespiteWarning}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </form>
  );
};

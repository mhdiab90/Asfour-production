/**
 * Universal Multi-Stage Production Entry Container
 * Houses the Stage Selector at the top and mounts the dedicated entry form
 * for whichever stage is selected.
 *
 * Bugfix (Part 3): every one of the 7 non-pressing forms accepts an
 * `onSuccess` callback and calls it after a successful save, but this
 * router previously mounted them with zero props, so `onSuccess` was
 * always undefined for every stage except Pressing - "what happens after a
 * successful save" silently did nothing for 7 of 8 stages. Now passed
 * uniformly, mirroring Pressing's own `onNavigate`/`onSuccess` wiring.
 */
import React, { useEffect, useState } from 'react';
import { ProductionStageType, NavigationPage } from '../../types';
import { useSetAssistantSelection } from '../../context/AssistantSelectionContext';
import { ProductionStageSelector } from './ProductionStageSelector';
import { ProductionEntryForm } from './ProductionEntryForm';
import { RotaryFurnaceEntryForm } from './RotaryFurnaceEntryForm';
import { ChineseMillsEntryForm } from './ChineseMillsEntryForm';
import { TubeBallMillsEntryForm } from './TubeBallMillsEntryForm';
import { MortarConcreteEntryForm } from './MortarConcreteEntryForm';
import { MixingEntryForm } from './MixingEntryForm';
import { LightweightFoamEntryForm } from './LightweightFoamEntryForm';
import { SortingEntryForm } from './SortingEntryForm';
import { ProductionAreaEntryForm } from './ProductionAreaEntryForm';
import { PackagingActivityPanel } from './PackagingActivityPanel';
import { packagingApplies } from '../../services/packagingActivityPure';
import { isProductionAreaStage } from '../../services/productionAreaPure';
import { useLanguage } from '../../i18n/LanguageContext';
import { ProductionReferencePanel } from './ProductionReferencePanel';
import type { ProductionReferenceSelection } from '../../services/productionReferencePure';
import { ProductionGenealogyPanel } from './ProductionGenealogyPanel';
import type { MaterialConsumptionItem, PackagingActivity, ProductionOutputLine } from '../../types';

/** Stages whose form already edits its own actual consumption (Step 5B); the others get it from the genealogy panel. */
const STAGES_WITH_FORM_CONSUMPTION: ProductionStageType[] = ['rotary_furnace', 'mortar_concrete', 'mixing', 'lightweight_foam', 'thermal_concrete', 'tunnel_kiln', 'handmade_brick'];

interface StageProductionEntryViewProps {
  onNavigate: (page: NavigationPage) => void;
  initialStage?: ProductionStageType;
}

export const StageProductionEntryView: React.FC<StageProductionEntryViewProps> = ({
  onNavigate,
  initialStage = 'pressing',
}) => {
  const [activeStage, setActiveStage] = useState<ProductionStageType>(initialStage);
  const { isRtl } = useLanguage();
  const setAssistantSelection = useSetAssistantSelection();
  /** Phase 1 Step 5A: optional job / batch traceability, shared by every stage form. */
  const [productionReferences, setProductionReferences] = useState<ProductionReferenceSelection>({});
  /** Phase 1 Step 6: outputs for every stage, and inputs for stages without their own consumption editor. */
  const [genealogyInputs, setGenealogyInputs] = useState<MaterialConsumptionItem[]>([]);
  const [productionOutputs, setProductionOutputs] = useState<ProductionOutputLine[]>([]);
  /** Phase 1 Step 8C-5: packing, only on the lines that pack their own output. */
  const [packaging, setPackaging] = useState<PackagingActivity | null>(null);
  const showPackaging = packagingApplies(activeStage);
  const productionGenealogy = { inputs: genealogyInputs, outputs: productionOutputs, packaging: showPackaging ? packaging : null };

  // Lines entered for one stage never carry over to another stage's record.
  useEffect(() => {
    setGenealogyInputs([]);
    setProductionOutputs([]);
    setPackaging(null);
  }, [activeStage]);

  useEffect(() => {
    setAssistantSelection({ currentStage: activeStage, selectedEntityType: 'productionRecord' });
    return () => setAssistantSelection({});
  }, [activeStage, setAssistantSelection]);

  const handleSuccess = () => {
    // The saved record took its inputs and outputs; the next entry starts empty.
    setGenealogyInputs([]);
    setProductionOutputs([]);
    setPackaging(null);
    // Same post-save behavior Pressing already gets (record saved, stays on
    // the entry screen ready for the next one) - now genuinely wired for
    // every stage instead of silently doing nothing.
  };

  return (
    <div className="space-y-6" dir={isRtl ? 'rtl' : 'ltr'}>
      {/* 8-Stage Visual Switcher */}
      <ProductionStageSelector
        selectedStage={activeStage}
        onSelectStage={setActiveStage}
      />

      {/* Optional job / batch traceability for the new record (Phase 1 Step 5A) */}
      <ProductionReferencePanel stageType={activeStage} value={productionReferences} onChange={setProductionReferences} />

      {/* Production output & genealogy (Phase 1 Step 6) - saved with the form below in its single write */}
      <ProductionGenealogyPanel
        showInputs={!STAGES_WITH_FORM_CONSUMPTION.includes(activeStage)}
        inputs={genealogyInputs}
        onInputsChange={setGenealogyInputs}
        outputs={productionOutputs}
        onOutputsChange={setProductionOutputs}
        jobReferenceId={productionReferences.jobReferenceId}
      />

      {/* Packing sub-activity (Phase 1 Step 8C-5) - packing lines only, saved with the form below */}
      {showPackaging && <PackagingActivityPanel value={packaging} onChange={setPackaging} />}

      {/* Dynamic Stage Entry Form */}
      <div>
        {activeStage === 'pressing' && (
          <ProductionEntryForm onNavigate={onNavigate} onSuccess={handleSuccess} productionReferences={productionReferences} productionGenealogy={productionGenealogy} />
        )}
        {activeStage === 'rotary_furnace' && (
          <RotaryFurnaceEntryForm onSuccess={handleSuccess} productionReferences={productionReferences} productionGenealogy={productionGenealogy} />
        )}
        {activeStage === 'chinese_mills' && (
          <ChineseMillsEntryForm onSuccess={handleSuccess} productionReferences={productionReferences} productionGenealogy={productionGenealogy} />
        )}
        {activeStage === 'tube_ball_mills' && (
          <TubeBallMillsEntryForm onSuccess={handleSuccess} productionReferences={productionReferences} productionGenealogy={productionGenealogy} />
        )}
        {activeStage === 'mortar_concrete' && (
          <MortarConcreteEntryForm onSuccess={handleSuccess} productionReferences={productionReferences} productionGenealogy={productionGenealogy} />
        )}
        {activeStage === 'mixing' && (
          <MixingEntryForm onSuccess={handleSuccess} productionReferences={productionReferences} productionGenealogy={productionGenealogy} />
        )}
        {activeStage === 'lightweight_foam' && (
          <LightweightFoamEntryForm onSuccess={handleSuccess} productionReferences={productionReferences} productionGenealogy={productionGenealogy} />
        )}
        {activeStage === 'sorting' && (
          <SortingEntryForm onSuccess={handleSuccess} productionReferences={productionReferences} productionGenealogy={productionGenealogy} />
        )}
        {isProductionAreaStage(activeStage) && (
          <ProductionAreaEntryForm stage={activeStage} onSuccess={handleSuccess} productionReferences={productionReferences} productionGenealogy={productionGenealogy} />
        )}
      </div>
    </div>
  );
};

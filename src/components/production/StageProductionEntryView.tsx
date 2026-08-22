/**
 * Universal Multi-Stage Production Entry Container
 * Houses the Stage Selector at the top and mounts the dedicated entry form
 * for whichever stage is selected.
 */
import React, { useState } from 'react';
import { ProductionStageType, NavigationPage } from '../../types';
import { ProductionStageSelector } from './ProductionStageSelector';
import { ProductionEntryForm } from './ProductionEntryForm';
import { RotaryFurnaceEntryForm } from './RotaryFurnaceEntryForm';
import { ChineseMillsEntryForm } from './ChineseMillsEntryForm';
import { TubeBallMillsEntryForm } from './TubeBallMillsEntryForm';
import { MortarConcreteEntryForm } from './MortarConcreteEntryForm';
import { MixingEntryForm } from './MixingEntryForm';
import { LightweightFoamEntryForm } from './LightweightFoamEntryForm';
import { SortingEntryForm } from './SortingEntryForm';

interface StageProductionEntryViewProps {
  onNavigate: (page: NavigationPage) => void;
  initialStage?: ProductionStageType;
}

export const StageProductionEntryView: React.FC<StageProductionEntryViewProps> = ({
  onNavigate,
  initialStage = 'pressing',
}) => {
  const [activeStage, setActiveStage] = useState<ProductionStageType>(initialStage);

  return (
    <div className="space-y-6" dir="rtl">
      {/* 8-Stage Visual Switcher */}
      <ProductionStageSelector
        selectedStage={activeStage}
        onSelectStage={setActiveStage}
      />

      {/* Dynamic Stage Entry Form */}
      <div>
        {activeStage === 'pressing' && (
          <ProductionEntryForm onNavigate={onNavigate} />
        )}
        {activeStage === 'rotary_furnace' && (
          <RotaryFurnaceEntryForm />
        )}
        {activeStage === 'chinese_mills' && (
          <ChineseMillsEntryForm />
        )}
        {activeStage === 'tube_ball_mills' && (
          <TubeBallMillsEntryForm />
        )}
        {activeStage === 'mortar_concrete' && (
          <MortarConcreteEntryForm />
        )}
        {activeStage === 'mixing' && (
          <MixingEntryForm />
        )}
        {activeStage === 'lightweight_foam' && (
          <LightweightFoamEntryForm />
        )}
        {activeStage === 'sorting' && (
          <SortingEntryForm />
        )}
      </div>
    </div>
  );
};

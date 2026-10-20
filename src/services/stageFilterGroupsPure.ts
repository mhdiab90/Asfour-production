/**
 * The stage filter of every records / reports screen (3.38.0).
 *
 * One selector covers: all stages, one stage, or a GROUP of stages that belong to one area of the plant -
 * "all mills" (the Chinese mills and the tube / ball mills) and "all kilns" (the rotary kiln with its
 * sub-centres, and the tunnel kiln). No screen is tied to one stage; each is the same cross-stage list,
 * narrowed by this filter. Pure.
 */
import type { ProductionStageType } from '../types';

export const STAGE_FILTER_ALL = 'all';

export interface StageFilterGroup {
  id: string;
  labelAr: string;
  labelEn: string;
  stages: readonly ProductionStageType[];
}

export const STAGE_FILTER_GROUPS: readonly StageFilterGroup[] = [
  { id: 'group:mills', labelAr: 'كل الطواحين (الصيني + الأنابيب والكرات)', labelEn: 'All mills (Chinese + tube/ball)', stages: ['chinese_mills', 'tube_ball_mills'] },
  { id: 'group:kilns', labelAr: 'كل الأفران (الدوار بمراكزه + النفقي)', labelEn: 'All kilns (rotary with its centres + tunnel)', stages: ['rotary_furnace', 'tunnel_kiln'] },
];

/** The stages a filter value stands for; null = no stage restriction (all). An unknown value restricts to nothing it can name. */
export function expandStageFilter(value: string | null | undefined, allStages: readonly ProductionStageType[]): ProductionStageType[] | null {
  if (!value || value === STAGE_FILTER_ALL) return null;
  const group = STAGE_FILTER_GROUPS.find((g) => g.id === value);
  if (group) return [...group.stages];
  return allStages.includes(value as ProductionStageType) ? [value as ProductionStageType] : [];
}

/** True when the filter value includes the rotary kiln, so its sub-centre (shakers / crushers) filter makes sense. */
export function includesRotaryKiln(value: string | null | undefined): boolean {
  return value === 'rotary_furnace' || value === 'group:kilns';
}

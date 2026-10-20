/**
 * COST-CENTRE NODE -> PRODUCTION STAGE (3.40.0).
 *
 * The cost-centre selector narrows records by the EQUIPMENT linked beneath the chosen nodes. Only pressing
 * and furnace records carry an equipment id, so choosing "الفرن الدوار" or "الطواحين الصينى" matched no
 * record of those stages - above all none of the Odoo import's, which carry a stage and a sub-centre, not an
 * equipment id. This table says which stage (and which rotary-kiln sub-centre) a production-department node
 * stands for, so choosing the node narrows the records of that stage.
 *
 * A node's rules are the union of its own and all its descendants' (a parent means itself and everything
 * below, exactly like the equipment scope). A leaf machine node with no rule here (one mill, one press)
 * narrows only by the equipment link, as before. Pure; the codes are the cost-centre sheet codes.
 */
import type { ProductionStageType } from '../types';
import { resolveHierarchyCodes, type HierarchyIndex, type HierarchyNodeInput } from './hierarchyResolverPure';

export type RotarySubCentre = 'MAIN' | 'rotary_shakers' | 'rotary_crushers';

export interface NodeStageRule {
  stage: ProductionStageType;
  /** Set where the node is ONE machine the Odoo work-centre name identifies (odooMachinePure.odooMachineKey). */
  machine?: string;
  /** Set only where the node is one centre of a stage that has several (the rotary kiln). */
  subCenter?: RotarySubCentre;
}

/** Production-department nodes of the cost-centre hierarchy and the stage each one is. */
export const NODE_STAGE_RULES: Readonly<Record<string, readonly NodeStageRule[]>> = {
  '501': [{ stage: 'rotary_furnace' }],
  '5011': [{ stage: 'rotary_furnace', subCenter: 'MAIN' }],
  '5012': [{ stage: 'rotary_furnace', subCenter: 'rotary_crushers' }],
  '5013': [{ stage: 'rotary_furnace', subCenter: 'rotary_shakers' }],
  '510': [{ stage: 'chinese_mills' }],
  // Single Chinese mills: Odoo names them "الطاحونه الصينيه رقم N".
  '5101': [{ stage: 'chinese_mills', machine: 'chinese_mills:1' }],
  '5102': [{ stage: 'chinese_mills', machine: 'chinese_mills:2' }],
  '5103': [{ stage: 'chinese_mills', machine: 'chinese_mills:3' }],
  '5104': [{ stage: 'chinese_mills', machine: 'chinese_mills:4' }],
  '5105': [{ stage: 'chinese_mills', machine: 'chinese_mills:5' }],
  '511': [{ stage: 'tube_ball_mills' }],
  // The ball mills and the tube mills: Odoo has one work centre for each kind, not per mill.
  '5111': [{ stage: 'tube_ball_mills', machine: 'tube_ball_mills:ball' }],
  '5112': [{ stage: 'tube_ball_mills', machine: 'tube_ball_mills:tube' }],
  '512': [{ stage: 'mixing' }],
  '513': [{ stage: 'pressing' }],
  '5135': [{ stage: 'handmade_brick' }],
  '514': [{ stage: 'tunnel_kiln' }],
  '515': [{ stage: 'lightweight_foam' }],
  '516': [{ stage: 'mortar_concrete' }],
};

/** The stage rules a node selection stands for; null = nothing selected, [] = nodes selected but none is a stage node. */
export function resolveStageRulesForNodes<T extends HierarchyNodeInput>(nodeIds: readonly string[], index: HierarchyIndex<T>): NodeStageRule[] | null {
  if (nodeIds.length === 0) return null;
  const out: NodeStageRule[] = [];
  const seen = new Set<string>();
  for (const code of resolveHierarchyCodes(index, nodeIds)) {
    for (const rule of NODE_STAGE_RULES[code] ?? []) {
      const key = `${rule.stage}|${rule.subCenter ?? ''}|${rule.machine ?? ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(rule);
    }
  }
  return out;
}

/** True when the record is one of the stage (and sub-centre) a rule names. */
export function recordMatchesStageRules(record: { stageType?: string; rawData?: Record<string, any> | null }, rules: readonly NodeStageRule[]): boolean {
  const own = String(record.rawData?.subCenterId ?? '');
  return rules.some((rule) => {
    if (record.stageType !== rule.stage) return false;
    if (rule.machine) return String(record.rawData?.odooMachineKey ?? '') === rule.machine;
    if (!rule.subCenter) return true;
    return rule.subCenter === 'MAIN' ? own === '' : own === rule.subCenter;
  });
}

/**
 * The cost-centre selection applied to records: kept when the record's equipment is in the scope OR it
 * belongs to a stage a selected node stands for. No selection (null scope, no rules) returns the records
 * untouched.
 */
export function applyHierarchySelection<T extends { stageType?: string; rawData?: Record<string, any> | null }>(
  records: readonly T[],
  equipmentScope: Set<string> | null,
  rules: readonly NodeStageRule[] | null | undefined,
  equipmentIdsOf: (record: T) => string[],
): T[] {
  const hasRules = !!rules && rules.length > 0;
  if (equipmentScope == null && !hasRules) return [...records];
  return records.filter((r) =>
    (equipmentScope != null && equipmentIdsOf(r).some((id) => equipmentScope.has(id)))
    || (hasRules && recordMatchesStageRules(r, rules!)));
}

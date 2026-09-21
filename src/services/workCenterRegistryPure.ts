/**
 * Work Center registry and normalisation - Phase 1 Step 8D. Pure and Firebase-free.
 *
 * Odoo writes a work centre as free text: "كبس", "الطاحونه الصينيه رقم 1",
 * "مكبس لايس 2000", "CM", "الفرن النفقى". ASFOUR needs three separate things out
 * of that one string, and never loses the original:
 *
 *   raw              exactly what the source said - always kept
 *   main centre      the ASFOUR production centre it belongs to
 *   equipment        the specific machine named inside it, when it names one
 *   rule / alias     which entry matched, so the decision is auditable
 *
 * NOTHING IS GUESSED. A name that is not in the alias table resolves to
 * UNMAPPED_CENTER - it is reported for review, never attached to the closest
 * looking centre. There is no fuzzy matching here at all.
 *
 * A CENTRE IS NOT ALWAYS A STAGE. Every main centre says which production record
 * type it writes to (`stageType`), and two centres deliberately have none:
 *   السرد              a separate downstream stage of the rotary-kiln area - NOT
 *                      the rotary furnace operation, so never written as one
 *   مركز الصب والفرم   not confirmed to be any existing stage
 * They resolve with NO_STAGE_MAPPING, so their rows stay visible and reviewable
 * instead of being written into a stage somebody guessed.
 *
 * TUBE vs BALL is read only when the raw text says it ("بول ميل" / "تيوب ميل");
 * otherwise the mill type stays unidentified, exactly as the mill master does.
 */
import type { ProductionStageType, TubeBallMillKind, WorkCenterResolution } from '../types';

export interface WorkCenterDefinition {
  /** Stable ASFOUR id for the centre - not a Firestore id. */
  id: string;
  nameAr: string;
  nameEn: string;
  /** The production record type this centre writes to, or null when it has none. */
  stageType: ProductionStageType | null;
  /** The centre this one belongs to, e.g. السرد under the rotary kiln. */
  parentCenterId?: string | null;
  /** Why a centre has no stage - reported, never worked around. */
  note?: string;
}

/**
 * The ASFOUR production centres. The eight/eleven existing stage ids are reused
 * verbatim as centre ids so nothing that already stores a stageType changes.
 */
export const WORK_CENTERS: readonly WorkCenterDefinition[] = [
  { id: 'pressing', nameAr: 'الكبس', nameEn: 'Pressing', stageType: 'pressing' },
  { id: 'mixing', nameAr: 'الخلط', nameEn: 'Mixing', stageType: 'mixing' },
  { id: 'chinese_mills', nameAr: 'الطواحين الصيني', nameEn: 'Chinese Mills', stageType: 'chinese_mills' },
  { id: 'tube_ball_mills', nameAr: 'الطواحين البول ميل والتيوب ميل', nameEn: 'Ball & Tube Mills', stageType: 'tube_ball_mills' },
  { id: 'tunnel_kiln', nameAr: 'الفرن النفقي', nameEn: 'Tunnel Kiln', stageType: 'tunnel_kiln' },
  { id: 'rotary_furnace', nameAr: 'الفرن الدوار', nameEn: 'Rotary Kiln', stageType: 'rotary_furnace' },
  { id: 'sorting', nameAr: 'الفرز', nameEn: 'Sorting', stageType: 'sorting' },
  { id: 'mortar_concrete_center', nameAr: 'مركز المونة والخرسانة', nameEn: 'Mortar & Concrete Center', stageType: 'mortar_concrete' },
  {
    // السرد is a SEPARATE downstream sizing / sorting stage in the rotary-kiln
    // area - it is NOT the rotary furnace operation. `parentCenterId` records
    // where it sits in the factory; it is never used to write a record into
    // `rotary_furnace`, and `stageType` stays null until the right ASFOUR
    // record type exists. Its rows stay visible and reviewable.
    id: 'sard',
    nameAr: 'السرد — تابع للفرن الدوار',
    nameEn: 'Sard (a separate stage in the rotary kiln area)',
    stageType: null,
    parentCenterId: 'rotary_furnace',
    note: 'NO PRODUCTION RECORD TYPE - a separate downstream stage of the rotary-kiln area, never the rotary furnace operation itself. Its stage is a business decision, never assumed.',
  },
  {
    // Deliberately NOT mapped to `lightweight_foam`: there is no business
    // confirmation for that, so nothing is written for this centre yet.
    id: 'casting_foam_center',
    nameAr: 'مركز الصب والفرم',
    nameEn: 'Casting & Foam Center',
    stageType: null,
    note: 'NO PRODUCTION RECORD TYPE - not mapped to lightweight_foam or any other stage without business confirmation.',
  },
];

const BY_ID = new Map(WORK_CENTERS.map((c) => [c.id, c]));

export function workCenterById(id: string | null | undefined): WorkCenterDefinition | null {
  return id ? BY_ID.get(id) ?? null : null;
}

/**
 * Arabic and Latin spelling differences that do not change the name: harakat,
 * tatweel, alef and yaa variants, taa marbuta, Arabic-Indic digits, punctuation
 * and repeated spaces. Comparison only - the raw text is never rewritten.
 */
export function normaliseWorkCenterText(value: unknown): string {
  return String(value ?? '')
    .trim()
    .replace(/[ً-ٰٟـ]/g, '')
    .replace(/[٠-٩]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0x0660 + 48))
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/[ىي]/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[ؤئء]/g, 'ء')
    .replace(/[_\-–—/\\,;:.!?'"()[\]{}«»]/g, ' ')
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .trim();
}

export interface WorkCenterAlias {
  /** The alias as the business gave it - compared after normalisation. */
  alias: string;
  centerId: string;
  /** EXACT: the whole name is the alias. CONTAINS: the alias appears inside a longer machine name. */
  match: 'EXACT' | 'CONTAINS';
}

/**
 * The approved alias table, verbatim from the business mapping, plus the
 * machine-name patterns that carry a centre inside them ("مكبس ...", "الطاحونه
 * الصينيه رقم 1"). Every entry is explicit - this list is the whole rule set.
 */
export const WORK_CENTER_ALIASES: readonly WorkCenterAlias[] = [
  // --- the approved mapping -------------------------------------------------
  { alias: 'CM', centerId: 'chinese_mills', match: 'EXACT' },
  { alias: 'الطواحين الصيني', centerId: 'chinese_mills', match: 'EXACT' },
  { alias: 'السرد', centerId: 'sard', match: 'EXACT' },
  { alias: 'فرز', centerId: 'sorting', match: 'EXACT' },
  { alias: 'الفرز', centerId: 'sorting', match: 'EXACT' },
  { alias: 'الصب والفوم', centerId: 'casting_foam_center', match: 'EXACT' },
  { alias: 'الصب والفرم', centerId: 'casting_foam_center', match: 'EXACT' },
  { alias: 'الفرن الدوار', centerId: 'rotary_furnace', match: 'EXACT' },
  { alias: 'المونة والخرسانة', centerId: 'mortar_concrete_center', match: 'EXACT' },
  { alias: 'الفرن النفقى', centerId: 'tunnel_kiln', match: 'EXACT' },
  { alias: 'الفرن النفقي', centerId: 'tunnel_kiln', match: 'EXACT' },
  { alias: 'كبس', centerId: 'pressing', match: 'EXACT' },
  { alias: 'الكبس', centerId: 'pressing', match: 'EXACT' },
  { alias: 'المكابس', centerId: 'pressing', match: 'EXACT' },
  { alias: 'خلط', centerId: 'mixing', match: 'EXACT' },
  { alias: 'الخلط', centerId: 'mixing', match: 'EXACT' },
  { alias: 'الخلاطات', centerId: 'mixing', match: 'EXACT' },
  { alias: 'الطواحين العاديه', centerId: 'tube_ball_mills', match: 'EXACT' },
  { alias: 'الطواحين العادية', centerId: 'tube_ball_mills', match: 'EXACT' },
  // --- machine names that name their centre ---------------------------------
  { alias: 'الطاحونه الصينيه', centerId: 'chinese_mills', match: 'CONTAINS' },
  { alias: 'طاحونه صيني', centerId: 'chinese_mills', match: 'CONTAINS' },
  { alias: 'مكبس', centerId: 'pressing', match: 'CONTAINS' },
  { alias: 'الطواحين الكرويه', centerId: 'tube_ball_mills', match: 'CONTAINS' },
  { alias: 'بول ميل', centerId: 'tube_ball_mills', match: 'CONTAINS' },
  { alias: 'طواحين اسطوانيه', centerId: 'tube_ball_mills', match: 'CONTAINS' },
  { alias: 'تيوب ميل', centerId: 'tube_ball_mills', match: 'CONTAINS' },
  { alias: 'الفرن النفقي', centerId: 'tunnel_kiln', match: 'CONTAINS' },
  { alias: 'الفرن الدوار', centerId: 'rotary_furnace', match: 'CONTAINS' },
  { alias: 'خلاط', centerId: 'mixing', match: 'CONTAINS' },
];

/** TUBE or BALL only when the raw text says so. */
const MILL_KIND_HINTS: ReadonlyArray<{ text: string; kind: TubeBallMillKind }> = [
  { text: 'بول ميل', kind: 'BALL' },
  { text: 'الطواحين الكرويه', kind: 'BALL' },
  { text: 'كرويه', kind: 'BALL' },
  { text: 'ball', kind: 'BALL' },
  { text: 'تيوب ميل', kind: 'TUBE' },
  { text: 'اسطوانيه', kind: 'TUBE' },
  { text: 'tube', kind: 'TUBE' },
];

function millKindOfText(normalized: string): TubeBallMillKind | null {
  for (const hint of MILL_KIND_HINTS) {
    if (normalized.includes(normaliseWorkCenterText(hint.text))) return hint.kind;
  }
  return null;
}

/** A user-approved mapping for a raw name the registry does not know (collection 'workCenters'). */
export interface ApprovedWorkCenterMapping {
  rawNormalized: string;
  mainCenterId: string;
  equipmentName?: string | null;
  active?: boolean;
}

const empty = (raw: string): WorkCenterResolution => ({
  raw,
  mainCenterId: null,
  mainCenterNameAr: null,
  stageType: null,
  equipmentName: null,
  millKind: null,
  matchedAlias: null,
  rule: 'EMPTY',
  status: 'EMPTY',
});

/**
 * Resolves one raw Odoo work-centre name. Pure: the same text always gives the
 * same answer, and the input is never modified.
 *
 * Order: an exact alias, then an approved mapping for this exact text, then an
 * alias that appears inside a machine name. Nothing else matches.
 */
export function resolveWorkCenter(
  raw: unknown,
  approved: readonly ApprovedWorkCenterMapping[] = [],
): WorkCenterResolution {
  const text = String(raw ?? '').trim();
  if (!text) return empty(text);
  const normalized = normaliseWorkCenterText(text);

  const build = (centerId: string, matchedAlias: string | null, rule: string, equipmentName: string | null): WorkCenterResolution => {
    const center = workCenterById(centerId);
    const millKind = center?.id === 'tube_ball_mills' ? millKindOfText(normalized) : null;
    return {
      raw: text,
      mainCenterId: center?.id ?? null,
      mainCenterNameAr: center?.nameAr ?? null,
      stageType: center?.stageType ?? null,
      equipmentName,
      millKind,
      matchedAlias,
      rule,
      status: !center ? 'UNMAPPED_CENTER' : center.stageType ? 'RESOLVED' : 'NO_STAGE_MAPPING',
    };
  };

  for (const entry of WORK_CENTER_ALIASES) {
    if (entry.match !== 'EXACT') continue;
    if (normaliseWorkCenterText(entry.alias) === normalized) {
      return build(entry.centerId, entry.alias, 'EXACT_ALIAS', null);
    }
  }

  const approvedMatch = approved.find((m) => m.active !== false && m.rawNormalized === normalized);
  if (approvedMatch) {
    return build(approvedMatch.mainCenterId, null, 'APPROVED_MAPPING', approvedMatch.equipmentName ?? text);
  }

  for (const entry of WORK_CENTER_ALIASES) {
    if (entry.match !== 'CONTAINS') continue;
    if (normalized.includes(normaliseWorkCenterText(entry.alias))) {
      // The whole raw text is the machine: "مكبس لايس 2000" belongs to الكبس and stays readable.
      return build(entry.centerId, entry.alias, 'MACHINE_NAME_CONTAINS_ALIAS', text);
    }
  }

  return {
    raw: text,
    mainCenterId: null,
    mainCenterNameAr: null,
    stageType: null,
    equipmentName: null,
    millKind: null,
    matchedAlias: null,
    rule: 'NO_ALIAS_MATCHED',
    status: 'UNMAPPED_CENTER',
  };
}

/** Whether a resolution may be written to a production record type. */
export function workCenterIsWritable(resolution: WorkCenterResolution | null | undefined): boolean {
  return Boolean(resolution && resolution.status === 'RESOLVED' && resolution.stageType);
}

/** One line describing how a work centre resolved - for the review table and the audit trail. */
export function describeWorkCenter(resolution: WorkCenterResolution): string {
  const parts = [`"${resolution.raw}"`, `-> ${resolution.mainCenterNameAr ?? resolution.status}`];
  if (resolution.equipmentName) parts.push(`equipment: ${resolution.equipmentName}`);
  if (resolution.millKind) parts.push(`mill: ${resolution.millKind}`);
  parts.push(`rule: ${resolution.rule}${resolution.matchedAlias ? ` (${resolution.matchedAlias})` : ''}`);
  return parts.join(' | ');
}

/** The distinct raw names in a set of rows, with how each one resolved - the "Work Centers" review tab. */
export function summariseWorkCenters(
  rawNames: readonly unknown[],
  approved: readonly ApprovedWorkCenterMapping[] = [],
): Array<{ raw: string; count: number; resolution: WorkCenterResolution }> {
  const byRaw = new Map<string, { raw: string; count: number; resolution: WorkCenterResolution }>();
  for (const value of rawNames) {
    const text = String(value ?? '').trim();
    if (!text) continue;
    const existing = byRaw.get(text);
    if (existing) {
      existing.count += 1;
      continue;
    }
    byRaw.set(text, { raw: text, count: 1, resolution: resolveWorkCenter(text, approved) });
  }
  return [...byRaw.values()].sort((a, b) => b.count - a.count || a.raw.localeCompare(b.raw));
}

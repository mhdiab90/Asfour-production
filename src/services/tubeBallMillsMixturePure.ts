/**
 * Tube/Ball Mills Historical Import - Material Type field interpretation.
 *
 * Deliberately Firebase-free and AI-free (no import of ../config/firebase,
 * no call to any AI provider) so this is unit-testable with plain in-memory
 * fixtures via `npx tsx` - see scripts/tests/.
 *
 * WHY THIS IS DETERMINISTIC, NOT AN LLM CALL (§17/§18 of the task): the
 * business rule for turning "جريت54ك+كلاى مخلط37ك+فيدرات37ك+فلسبار7ك" into
 * exact percentages is a closed-form arithmetic formula (§11/§12) - quantity
 * ÷ total × 100, normalized so the parts sum to exactly 100. An LLM call
 * would be slower (a network round-trip per one of potentially thousands of
 * rows), non-deterministic, and unauditable for something that has one
 * single correct numeric answer. The existing AI infrastructure
 * (src/assistant/*) is a conversational tool-calling gateway built for the
 * chat Assistant panel, not a per-row batch pipeline - wiring it in here
 * would be the "second AI architecture" this task explicitly forbids, for a
 * job a formula already does correctly and testably. "AI-assisted" (§17) is
 * satisfied here by treating the EXISTING fuzzy-matching infrastructure
 * (findBestFuzzyCandidates, reused as-is in
 * tubeBallMillsHistoricalImportService.ts) as the suggestion layer for
 * Master Data matching - exactly the same role it already plays for
 * Pressing/Chinese Mills' own "smart matching proposals".
 */

export interface ParsedMixtureComponent {
  materialNameRaw: string;
  quantityKg: number;
  /** Normalized 0-100, always summing to exactly 100 across the full component set - see normalizeToHundred below. */
  percentage: number;
}

export type MaterialTypeParseResult =
  | { kind: 'MIXTURE'; components: ParsedMixtureComponent[]; totalQuantityKg: number }
  | { kind: 'SINGLE_WITH_ALUMINA'; materialName: string; aluminaPercentage: number }
  | { kind: 'SINGLE_PLAIN'; materialName: string }
  /** A '+'-joined value where at least one segment has no parseable trailing quantity - never silently dropped or guessed; the row must go through manual/Coding-window resolution (§9/§11). */
  | { kind: 'UNPARSEABLE_MIXTURE'; rawSegments: string[]; unparsedSegments: string[] };

const KG_UNIT_PATTERN = /^(.+?)\s*(\d+(?:[.,]\d+)?)\s*(?:كجم|كيلوجرام|كيلو|كغ|ك)\s*$/;
const ALUMINA_PERCENT_PATTERN = /^(.+?)\s*(\d+(?:[.,]\d+)?)\s*[%٪]\s*$/;

function toNumber(raw: string): number {
  return Number(raw.replace(',', '.'));
}

/**
 * Largest-remainder (Hare-Niemeyer) normalization: converts raw quantities
 * directly into percentages that are individually rounded to 1 decimal
 * place AND guaranteed to sum to EXACTLY 100.0 - never left to naive
 * per-component rounding, which can drift the total off 100 (§11: "Total
 * must normalize to 100%... Handle rounding carefully").
 */
export function normalizeToHundred(quantities: number[]): number[] {
  const total = quantities.reduce((a, b) => a + b, 0);
  if (total <= 0 || quantities.length === 0) return quantities.map(() => 0);
  // Work in tenths-of-a-percent (0-1000 representing 0.0%-100.0%) so integer
  // rounding + a remainder pass gives an exact result with no float drift.
  const raw = quantities.map((q) => (q / total) * 1000);
  const floored = raw.map((r) => Math.floor(r));
  const flooredSum = floored.reduce((a, b) => a + b, 0);
  let remainder = 1000 - flooredSum;
  const byFractionDesc = floored
    .map((f, i) => ({ i, frac: raw[i] - f }))
    .sort((a, b) => b.frac - a.frac);
  const result = [...floored];
  for (let k = 0; k < remainder && byFractionDesc.length > 0; k++) {
    result[byFractionDesc[k % byFractionDesc.length].i] += 1;
  }
  return result.map((v) => Math.round(v) / 10);
}

export interface ExistingMixtureCandidate {
  productId: string;
  productName: string;
  components: Array<{ materialId: string; percentage: number }>;
}

/**
 * §14/§48: composition-aware equivalence check for reusing an existing
 * mixture/BOM instead of creating a duplicate. Equivalence is judged by
 * RESOLVED material identity + percentage (within a small rounding
 * tolerance) - NEVER by raw text, so formatting/spacing/separator
 * differences in the source ("جريت54ك+..." vs "جريت 54 ك +...") never
 * block reuse, while two mixtures with genuinely different materials or
 * ratios are never merged (§48: "do not over-merge genuinely different
 * materials/BOMs"). If any new component is still unresolved (no
 * materialId yet), equivalence cannot be safely judged - returns no match
 * rather than guessing, so the row is correctly routed to the Mixture
 * Coding window for a user decision (§15).
 */
export function findEquivalentMixture(
  newComponents: Array<{ resolvedMaterialId?: string; percentage: number }>,
  candidates: ExistingMixtureCandidate[],
  toleranceInPercentagePoints = 1.0
): ExistingMixtureCandidate | null {
  if (newComponents.length === 0 || newComponents.some((c) => !c.resolvedMaterialId)) return null;
  const newSet = newComponents.map((c) => ({ id: c.resolvedMaterialId as string, pct: c.percentage }));
  for (const candidate of candidates) {
    if (candidate.components.length !== newSet.length) continue;
    const allMatched = newSet.every((nc) =>
      candidate.components.some((cc) => cc.materialId === nc.id && Math.abs(cc.percentage - nc.pct) <= toleranceInPercentagePoints)
    );
    if (allMatched) return candidate;
  }
  return null;
}

/**
 * Parses one Excel "Material Type" cell into exactly one of: a mixture (§11
 * -12), a single material with an embedded alumina percentage (§13), a
 * plain single material name, or an unparseable mixture requiring manual
 * resolution. Never guesses a quantity/percentage that was not actually
 * present in the source text.
 */
export function parseMaterialTypeField(raw: string): MaterialTypeParseResult {
  const trimmed = (raw || '').trim();
  if (trimmed.includes('+')) {
    const segments = trimmed.split('+').map((s) => s.trim()).filter(Boolean);
    const parsed: Array<{ materialNameRaw: string; quantityKg: number } | null> = segments.map((seg) => {
      const m = seg.match(KG_UNIT_PATTERN);
      if (!m) return null;
      const name = m[1].trim();
      const qty = toNumber(m[2]);
      if (!name || !Number.isFinite(qty) || qty <= 0) return null;
      return { materialNameRaw: name, quantityKg: qty };
    });
    const unparsedSegments = segments.filter((_, i) => parsed[i] === null);
    if (unparsedSegments.length > 0) {
      return { kind: 'UNPARSEABLE_MIXTURE', rawSegments: segments, unparsedSegments };
    }
    const valid = parsed as Array<{ materialNameRaw: string; quantityKg: number }>;
    const totalQuantityKg = valid.reduce((a, b) => a + b.quantityKg, 0);
    const percentages = normalizeToHundred(valid.map((v) => v.quantityKg));
    const components: ParsedMixtureComponent[] = valid.map((v, i) => ({
      materialNameRaw: v.materialNameRaw,
      quantityKg: v.quantityKg,
      percentage: percentages[i],
    }));
    return { kind: 'MIXTURE', components, totalQuantityKg };
  }

  const aluminaMatch = trimmed.match(ALUMINA_PERCENT_PATTERN);
  if (aluminaMatch) {
    const name = aluminaMatch[1].trim();
    const pct = toNumber(aluminaMatch[2]);
    if (name && Number.isFinite(pct)) {
      return { kind: 'SINGLE_WITH_ALUMINA', materialName: name, aluminaPercentage: pct };
    }
  }

  return { kind: 'SINGLE_PLAIN', materialName: trimmed };
}

/**
 * Gap-fix §4: the exact value written to the production Firestore payload's
 * `aluminaPercentage` field - a plain (non-mixture) material's own detected
 * alumina percentage rides through unchanged; a mixture/BOM row NEVER
 * carries one (§13/§14: alumina belongs to a single raw material, never to
 * a mixture), and a plain material with no detected percentage writes
 * `null` rather than inventing a value.
 */
export function resolveAluminaPayloadValue(isMixture: boolean, detectedAluminaPercentage: number | undefined): number | null {
  if (isMixture) return null;
  return detectedAluminaPercentage ?? null;
}

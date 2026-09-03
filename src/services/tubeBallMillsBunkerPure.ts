/**
 * Tube/Ball Mills Historical Import - Storage Bunkers field parsing and
 * production-distribution logic (§19-22).
 *
 * Firebase-free and AI-free - see tubeBallMillsMixturePure.ts's header for
 * why: bunker splitting/allocation is exact arithmetic, not interpretation.
 */

/** "54" -> ["54"]; "54-65-66" -> ["54","65","66"]. Never confuses this with a product/mill code that happens to contain a hyphen elsewhere in the pipeline - this parser is ONLY ever applied to the Storage Bunkers column (§19). */
export function parseBunkerTokens(raw: string): string[] {
  const trimmed = (raw || '').trim();
  if (!trimmed) return [];
  return trimmed
    .split('-')
    .map((t) => t.trim())
    .filter(Boolean);
}

export interface SuggestedBunkerAllocation {
  bunkerRaw: string;
  allocatedTons: number;
}

/**
 * §22: default SUGGESTION only - an equal split of totalTons across every
 * parsed bunker, rounded so the parts sum EXACTLY to totalTons (same
 * largest-remainder-style approach as the mixture normalizer, adapted for
 * tonnage instead of percentage - see the rounding note there). The caller
 * (the panel) must present this as editable, never as an assumed historical
 * fact (§22: "Do NOT silently assume equal distribution is historically true").
 */
export function suggestEqualBunkerDistribution(bunkerTokens: string[], totalTons: number): SuggestedBunkerAllocation[] {
  const n = bunkerTokens.length;
  if (n === 0) return [];
  if (!Number.isFinite(totalTons) || totalTons <= 0) {
    return bunkerTokens.map((b) => ({ bunkerRaw: b, allocatedTons: 0 }));
  }
  const base = Math.floor((totalTons / n) * 100) / 100; // 2-decimal tons precision
  const allocations = bunkerTokens.map((b) => ({ bunkerRaw: b, allocatedTons: base }));
  // Distribute the rounding remainder (in cents of a ton) to bunkers one at a time so the sum is exact.
  let remainderCents = Math.round((totalTons - base * n) * 100);
  let i = 0;
  while (remainderCents > 0 && n > 0) {
    allocations[i % n].allocatedTons = Math.round((allocations[i % n].allocatedTons + 0.01) * 100) / 100;
    remainderCents -= 1;
    i += 1;
  }
  return allocations;
}

/** §22: the hard blocking rule - allocations must sum to EXACTLY totalTons before the row can import. Tolerant of floating-point noise only up to 1 cent of a ton (never a business tolerance, purely a float-precision guard). */
export function isBunkerAllocationValid(allocations: Array<{ allocatedTons: number }>, totalTons: number): boolean {
  if (allocations.length === 0) return false;
  const sum = allocations.reduce((a, b) => a + (Number(b.allocatedTons) || 0), 0);
  return Math.abs(sum - totalTons) < 0.01;
}

/**
 * Gap-fix §5/§22: resolves the bunker quantities to use for THIS revalidation
 * pass - preserving a user's previously-edited allocation instead of
 * silently regenerating the equal-split suggestion every time a row is
 * revalidated (Manual Edit save, Global Mapping propagation, final
 * pre-execute revalidation, etc. all re-run resolution). Preservation only
 * applies when the CURRENT set of parsed bunker tokens is identical to the
 * previous one (same bunkers, any order) - if a bunker was added/removed via
 * an edit to the Storage Bunkers cell, the token set has genuinely changed
 * and a fresh equal split is generated for the whole set rather than risk a
 * partial-preserve/partial-suggest allocation that no longer even attempts
 * to sum to Total. When there is no previous allocation at all (first parse
 * of a freshly uploaded file), always falls back to the equal-split
 * suggestion - exactly the pre-existing behavior.
 */
export function resolveBunkerAllocationQuantities(
  bunkerTokens: string[],
  totalTons: number,
  previousAllocations?: Array<{ bunkerRaw: string; allocatedTons: number }>
): SuggestedBunkerAllocation[] {
  if (previousAllocations && previousAllocations.length === bunkerTokens.length) {
    const prevMap = new Map(previousAllocations.map((p) => [p.bunkerRaw, p.allocatedTons]));
    const sameTokenSet = bunkerTokens.every((tok) => prevMap.has(tok));
    if (sameTokenSet) {
      return bunkerTokens.map((tok) => ({ bunkerRaw: tok, allocatedTons: prevMap.get(tok) as number }));
    }
  }
  return suggestEqualBunkerDistribution(bunkerTokens, totalTons);
}

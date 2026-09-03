/**
 * Tube/Ball Mills Historical Import - Hours/Tons-Per-Hour/Total field
 * resolution (§23-25, §J "Optional vs Required").
 *
 * Firebase-free and pure so this is unit-testable via `npx tsx` - see
 * scripts/tests/. Extracted out of tubeBallMillsHistoricalImportService.ts
 * (which cannot be imported outside a Vite runtime - it transitively pulls
 * in ../config/firebase, whose `import.meta.env` access throws under plain
 * Node/tsx; verified empirically, not assumed) specifically so this
 * REQUIRED-vs-OPTIONAL business logic - the actual thing task audits keep
 * asking about - has real, direct test coverage rather than resting on
 * code review alone.
 *
 * Required/optional status is taken verbatim from the EXISTING generic
 * import field schema (productionStageConfig.ts's `tube_ball_mills` entry):
 * only `totalTons` is `required: true`; `operatingHours` and `tonsPerHour`
 * are both `required: false`. Never guessed.
 */
import { toWesternDigits } from '../utils/formatters';

export interface NumericFieldsResult {
  operatingHours: number;
  /** False only when Hours was PROVIDED but could not be parsed as a non-negative number - a blank value is never invalid (optional field). */
  hoursValid: boolean;
  totalTons: number;
  /** False when Total is blank, unparseable, or <= 0 - Total is the one REQUIRED field for this stage. */
  totalValid: boolean;
  tonsPerHour: number;
  /** False only when Tons/Hour was PROVIDED but could not be parsed - a blank value is never invalid (optional field), see tonsPerHourDerived instead. */
  tonsPerHourValid: boolean;
  /** True when the source left Tons/Hour blank and it was derived from Total/Hours instead - NEVER silent (§I): the caller must always surface this flag, never present a derived value as if the source provided it. */
  tonsPerHourDerived: boolean;
  /** True when a PROVIDED Tons/Hour materially disagrees with Total/Hours - a WARNING only, never blocking, the declared source value is kept as-is either way. */
  tonsPerHourMismatch: boolean;
}

/** Mirrors the exact parsing tubeBallMillsHistoricalImportService.ts (and every other historical-import service in this app) already uses - Arabic-Indic digits included, never a second/divergent numeric parser. */
function parseNum(raw: string): number | null {
  if (!raw) return null;
  const western = toWesternDigits(raw).replace(/,/g, '').trim();
  if (!western) return null;
  const n = Number(western);
  return Number.isFinite(n) ? n : null;
}

export function resolveNumericFields(hoursRaw: string, totalRaw: string, tonsPerHourRaw: string): NumericFieldsResult {
  const hoursTrimmed = (hoursRaw || '').trim();
  const hoursParsed = parseNum(hoursRaw);
  const operatingHours = hoursParsed ?? 0;
  // Optional (required: false): blank is always valid; only a provided-but-malformed value is invalid.
  const hoursValid = hoursTrimmed === '' || (hoursParsed !== null && operatingHours >= 0);

  const totalTrimmed = (totalRaw || '').trim();
  const totalParsed = parseNum(totalRaw);
  const totalTons = totalParsed ?? 0;
  // Required (required: true): blank, unparseable, or non-positive are all invalid.
  const totalValid = totalTrimmed !== '' && totalParsed !== null && totalTons > 0;

  const tphTrimmed = (tonsPerHourRaw || '').trim();
  const tphParsed = parseNum(tonsPerHourRaw);
  let tonsPerHour = tphParsed ?? 0;
  let tonsPerHourValid = true;
  let tonsPerHourDerived = false;
  let tonsPerHourMismatch = false;

  if (tphTrimmed !== '') {
    // Optional (required: false), but PROVIDED - must be parseable.
    tonsPerHourValid = tphParsed !== null;
    if (tonsPerHourValid && operatingHours > 0 && totalTons > 0) {
      const derivedRate = totalTons / operatingHours;
      tonsPerHourMismatch = Math.abs(derivedRate - tonsPerHour) > Math.max(0.5, derivedRate * 0.1);
    }
  } else if (operatingHours > 0 && totalTons > 0) {
    // Blank + optional -> derive rather than block (§J), always flagged.
    tonsPerHour = Number((totalTons / operatingHours).toFixed(2));
    tonsPerHourDerived = true;
  }

  return { operatingHours, hoursValid, totalTons, totalValid, tonsPerHour, tonsPerHourValid, tonsPerHourDerived, tonsPerHourMismatch };
}

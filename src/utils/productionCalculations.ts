/**
 * ASFOUR Factory Management ERP - Production Measurement & Calculations Engine
 * 
 * FACTORY STANDARD UNIT: TON
 * The PRIMARY production measurement for factory reporting and KPIs is TON.
 * 
 * Rules:
 * 1. Piece-Based Stages (COUNT):
 *    - Production Weight Kg = Production Count * Piece Weight Kg
 *    - Production Weight Tons = (Production Count * Piece Weight Kg) / 1000
 *    - Waste Weight Kg = Waste Count * Piece Weight Kg
 *    - Waste Weight Tons = (Waste Count * Piece Weight Kg) / 1000
 *    - Good Count = Production Count - Waste Count
 *    - Good Weight Kg = Good Count * Piece Weight Kg
 *    - Good Weight Tons = (Good Count * Piece Weight Kg) / 1000
 *    - If Piece Weight is missing: Do NOT invent or use 0! Return null (displayed as "غير محسوب")
 * 
 * 2. Ton-Based Stages (TON):
 *    - Direct entry of Tons.
 *    - Do NOT require Piece Weight.
 * 
 * 3. Productivity & Consumption:
 *    - Waste % = (Waste Tons / Production Tons) * 100 (or count-based fallback)
 *    - Production Rate (Tons/Hour) = Production Tons / Operating Hours
 *    - Labor Productivity (Tons/Labor Hour) = Production Tons / Total Labor Hours
 *    - Material per Ton = Material Qty / Production Tons
 *    - Gas per Ton = Gas Qty / Production Tons
 *    - Electricity per Ton = Electricity Qty / Production Tons
 */

import { 
  ProductionInputUnit, 
  QuantitySource, 
  CalculationMethod, 
  ProductionStageType 
} from '../types';

export interface CalculatedProductionOutput {
  // Counts
  productionCount?: number;
  wasteCount?: number;
  goodCount?: number;

  // Piece Weight
  pieceWeightKg?: number | null;
  hasValidPieceWeight: boolean;
  pieceWeightStatusText: string;

  // Weights (Kg)
  productionKg?: number | null;
  goodKg?: number | null;
  wasteKg?: number | null;

  // Weights (Tons) - Primary Factory Metric
  productionTons: number | null;
  goodTons: number | null;
  wasteTons: number | null;

  // Rates & Metrics
  wastePercentage: number;
  productionRateTonsPerHour?: number | null;
  laborProductivityTonsPerHour?: number | null;

  // Metadata
  productionUnit: ProductionInputUnit;
  quantitySource: QuantitySource;
  calculationMethod: CalculationMethod;
  mismatchWarnings: string[];
}

/**
 * Standard Production Stage Unit Configurations
 */
export const STAGE_PRODUCTION_UNITS: Record<ProductionStageType, ProductionInputUnit> = {
  pressing: 'COUNT',          // COUNT + Piece Weight -> TON
  rotary_furnace: 'TON',      // TON
  chinese_mills: 'MIXED',     // TON and/or bags
  tube_ball_mills: 'TON',     // TON
  mortar_concrete: 'MIXED',   // TON and/or bags
  mixing: 'TON',              // TON
  lightweight_foam: 'MIXED',  // COUNT + Piece Weight OR TON
  sorting: 'COUNT',           // COUNT + Piece Weight -> TON
};

/**
 * Standard Stage Unit Arabic Labels
 */
export const STAGE_UNIT_LABELS: Record<ProductionInputUnit, string> = {
  COUNT: 'بالعدد / قطعة (مع وزن القطعة لإيجاد الطن)',
  KG: 'بالكيلوجرام (كجم)',
  TON: 'بالطن مباشرة (طن)',
  MIXED: 'مختلط (طن / شكائر / قطع)',
};

/**
 * Pure calculation for piece-based production (Pressing, Sorting, etc.)
 */
export function calculatePieceBasedProduction(params: {
  productionCount: number;
  wasteCount?: number;
  pieceWeightKg?: number | null;
  operatingHours?: number;
  laborHours?: number;
  importedTons?: number | null;
  importedWasteTons?: number | null;
  source?: QuantitySource;
}): CalculatedProductionOutput {
  const prodCount = Math.max(0, Number(params.productionCount) || 0);
  const wasteCount = Math.max(0, Number(params.wasteCount) || 0);
  const goodCount = Math.max(0, prodCount - wasteCount);

  const rawWeight = params.pieceWeightKg !== undefined && params.pieceWeightKg !== null
    ? Number(params.pieceWeightKg)
    : null;

  const hasValidPieceWeight = rawWeight !== null && !isNaN(rawWeight) && rawWeight > 0;
  const pieceWeightKg = hasValidPieceWeight ? rawWeight : null;
  const pieceWeightStatusText = hasValidPieceWeight ? `${pieceWeightKg} كجم` : 'وزن القطعة غير متوفر';

  const warnings: string[] = [];

  let productionKg: number | null = null;
  let goodKg: number | null = null;
  let wasteKg: number | null = null;
  let productionTons: number | null = null;
  let goodTons: number | null = null;
  let wasteTons: number | null = null;
  let calculationMethod: CalculationMethod = 'NOT_CALCULATED';
  let quantitySource: QuantitySource = params.source || 'CALCULATED_FROM_COUNT';

  if (hasValidPieceWeight && pieceWeightKg !== null) {
    calculationMethod = 'COUNT_X_PIECE_WEIGHT';
    // Full precision calculations
    productionKg = prodCount * pieceWeightKg;
    goodKg = goodCount * pieceWeightKg;
    wasteKg = wasteCount * pieceWeightKg;

    productionTons = productionKg / 1000;
    goodTons = goodKg / 1000;
    wasteTons = wasteKg / 1000;

    // Check for imported tons mismatch
    if (params.importedTons !== undefined && params.importedTons !== null && params.importedTons > 0) {
      const diff = Math.abs(params.importedTons - productionTons);
      if (diff > 0.05) { // more than 50 kg variance
        warnings.push(`PRODUCTION_TON_MISMATCH: المحسوب (${productionTons.toFixed(2)} طن) يختلف عن الملف (${params.importedTons.toFixed(2)} طن)`);
      }
    }

    if (params.importedWasteTons !== undefined && params.importedWasteTons !== null && params.importedWasteTons > 0) {
      const diff = Math.abs(params.importedWasteTons - (wasteTons || 0));
      if (diff > 0.05) {
        warnings.push(`WASTE_TON_MISMATCH: هالك الأطنان المحسوب (${(wasteTons || 0).toFixed(2)} طن) يختلف عن الملف (${params.importedWasteTons.toFixed(2)} طن)`);
      }
    }
  } else if (params.importedTons !== undefined && params.importedTons !== null && params.importedTons > 0) {
    // Count available + imported Tons available, but piece weight missing
    productionTons = params.importedTons;
    productionKg = productionTons * 1000;
    quantitySource = 'IMPORTED_HISTORICAL';
    calculationMethod = 'DIRECT_TON';
    warnings.push('MANUAL_TON_VALUE: تم حفظ الطن من الملف بدون وزن قطعة');
  }

  // Waste Percentage calculation (Ton-based preferred if available, else Count-based)
  let wastePercentage = 0;
  if (productionTons !== null && productionTons > 0 && wasteTons !== null) {
    wastePercentage = Number(((wasteTons / productionTons) * 100).toFixed(2));
  } else if (prodCount > 0) {
    wastePercentage = Number(((wasteCount / prodCount) * 100).toFixed(2));
  }

  // Production Rate Tons/Hour
  let productionRateTonsPerHour: number | null = null;
  if (productionTons !== null && params.operatingHours && params.operatingHours > 0) {
    productionRateTonsPerHour = Number((productionTons / params.operatingHours).toFixed(3));
  }

  // Labor Productivity Tons/Labor Hour
  let laborProductivityTonsPerHour: number | null = null;
  if (productionTons !== null && params.laborHours && params.laborHours > 0) {
    laborProductivityTonsPerHour = Number((productionTons / params.laborHours).toFixed(3));
  }

  return {
    productionCount: prodCount,
    wasteCount,
    goodCount,
    pieceWeightKg,
    hasValidPieceWeight,
    pieceWeightStatusText,
    productionKg,
    goodKg,
    wasteKg,
    productionTons,
    goodTons,
    wasteTons,
    wastePercentage,
    productionRateTonsPerHour,
    laborProductivityTonsPerHour,
    productionUnit: 'COUNT',
    quantitySource,
    calculationMethod,
    mismatchWarnings: warnings,
  };
}

/**
 * Pure calculation for direct Ton-based production (Rotary Furnace, Ball Mills, Mixing, etc.)
 */
export function calculateTonBasedProduction(params: {
  productionTons: number;
  wasteTons?: number;
  operatingHours?: number;
  laborHours?: number;
  source?: QuantitySource;
}): CalculatedProductionOutput {
  const prodTons = Math.max(0, Number(params.productionTons) || 0);
  const wasteTons = Math.max(0, Number(params.wasteTons) || 0);
  const goodTons = Math.max(0, prodTons - wasteTons);

  const productionKg = prodTons * 1000;
  const goodKg = goodTons * 1000;
  const wasteKg = wasteTons * 1000;

  const wastePercentage = prodTons > 0 
    ? Number(((wasteTons / prodTons) * 100).toFixed(2)) 
    : 0;

  let productionRateTonsPerHour: number | null = null;
  if (prodTons > 0 && params.operatingHours && params.operatingHours > 0) {
    productionRateTonsPerHour = Number((prodTons / params.operatingHours).toFixed(3));
  }

  let laborProductivityTonsPerHour: number | null = null;
  if (prodTons > 0 && params.laborHours && params.laborHours > 0) {
    laborProductivityTonsPerHour = Number((prodTons / params.laborHours).toFixed(3));
  }

  return {
    pieceWeightKg: null,
    hasValidPieceWeight: false,
    pieceWeightStatusText: 'غير منطبق (مرحلة بالطن مباشرة)',
    productionKg,
    goodKg,
    wasteKg,
    productionTons: prodTons,
    goodTons,
    wasteTons,
    wastePercentage,
    productionRateTonsPerHour,
    laborProductivityTonsPerHour,
    productionUnit: 'TON',
    quantitySource: params.source || 'DIRECT_ENTRY',
    calculationMethod: 'DIRECT_TON',
    mismatchWarnings: [],
  };
}

/**
 * Calculate Material / Energy Specific Consumption per Ton
 */
export function calculateConsumptionPerTon(
  consumptionQuantity: number,
  productionTons: number | null | undefined
): number | null {
  if (productionTons === null || productionTons === undefined || productionTons <= 0) {
    return null;
  }
  const qty = Number(consumptionQuantity) || 0;
  return Number((qty / productionTons).toFixed(3));
}

/**
 * Format Ton values for UI Display
 * Displays exact decimal string or "غير محسوب" if null
 */
export function formatTonsDisplay(tons: number | null | undefined, decimals = 2): string {
  if (tons === null || tons === undefined || isNaN(tons)) {
    return 'غير محسوب';
  }
  return tons.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }) + ' طن';
}

/**
 * Format Piece Weight for UI Display
 */
export function formatPieceWeightDisplay(weight: number | null | undefined): string {
  if (weight === null || weight === undefined || isNaN(weight) || weight <= 0) {
    return 'وزن القطعة غير متوفر';
  }
  return `${weight} كجم`;
}

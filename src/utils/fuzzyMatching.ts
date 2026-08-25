/**
 * ASFOUR ERP - Smart Fuzzy Matching Engine & Arabic Normalizer
 * 
 * Production-grade string normalization, token similarity, character edit distance (Levenshtein),
 * and domain-aware candidate ranking for historical Excel data import.
 */

export type MatchType = 
  | 'EXACT_CODE' 
  | 'EXACT_NAME' 
  | 'NORMALIZED_NAME' 
  | 'FUZZY_NAME' 
  | 'PARTIAL_NAME' 
  | 'CODE_SIMILARITY' 
  | 'COMBINED_CODE_NAME' 
  | 'PREVIOUSLY_APPROVED_MAPPING' 
  | 'MANUAL_MAPPING';

export interface FuzzyCandidate<T = any> {
  entity: T;
  id: string;
  code: string;
  name: string;
  confidence: number; // 0 to 100
  matchType: MatchType;
  reasonAr: string;
  reasonEn: string;
  diffCount?: number;
}

export interface ProposedFieldMatch {
  fieldDomain: string; // e.g. 'press' | 'employee' | 'product' | 'customer' | 'shift' | 'furnace' | 'material'
  fieldNameAr: string;
  fieldNameEn: string;
  importedValue: string;
  normalizedImportedValue: string;
  suggestedMatch: FuzzyCandidate | null;
  allCandidates: FuzzyCandidate[];
  decision: 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'MANUAL' | 'SKIPPED';
  manualSelectedId?: string;
  manualSelectedName?: string;
}

/**
 * Standardize Arabic characters, removing harakat, tatweel, and normalizing letter variants.
 */
export function normalizeArabicForComparison(input: string | null | undefined): string {
  if (!input) return '';
  return String(input)
    .trim()
    // Convert eastern arabic digits to western
    .replace(/[٠-٩]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 1632 + 48))
    // Remove diacritics / harakat / tashkeel & tatweel
    .replace(/[\u064B-\u065F\u0670\u0640]/g, '')
    // Normalize Alef variants
    .replace(/[أإآٱ]/g, 'ا')
    // Normalize Yaa & Alef Maqsura
    .replace(/[ىي]/g, 'ي')
    // Normalize Taa Marbuta & Haa
    .replace(/ة/g, 'ه')
    // Normalize Hamza forms
    .replace(/[ؤئء]/g, 'ء')
    // Remove punctuation, slashes, dashes, quotes, brackets
    .replace(/[_\-–—/\\,;:!?'"()[\]{}«»]/g, ' ')
    // Collapse multiple whitespaces
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .trim();
}

/**
 * Normalize codes for flexible matching (strips leading zeroes, hyphens, spaces).
 */
export function normalizeCodeForComparison(code: string | null | undefined): string {
  if (!code) return '';
  return String(code)
    .trim()
    .replace(/[٠-٩]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 1632 + 48))
    .replace(/[-_/ \s]/g, '')
    .toUpperCase();
}

/**
 * Levenshtein distance calculation between two normalized strings.
 */
export function calculateLevenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  const matrix: number[][] = [];

  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }

  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1,     // insertion
          matrix[i - 1][j] + 1      // deletion
        );
      }
    }
  }

  return matrix[b.length][a.length];
}

/**
 * Normalized similarity ratio (0 - 100) based on Levenshtein edit distance.
 */
export function calculateStringSimilarity(str1: string, str2: string): { similarity: number; distance: number } {
  const norm1 = normalizeArabicForComparison(str1);
  const norm2 = normalizeArabicForComparison(str2);

  if (norm1 === norm2) return { similarity: 100, distance: 0 };
  if (!norm1.length || !norm2.length) return { similarity: 0, distance: Math.max(norm1.length, norm2.length) };

  const distance = calculateLevenshteinDistance(norm1, norm2);
  const maxLen = Math.max(norm1.length, norm2.length);
  const rawRatio = ((maxLen - distance) / maxLen) * 100;
  const similarity = Math.max(0, Math.min(100, Math.round(rawRatio)));

  return { similarity, distance };
}

/**
 * Token overlap / Jaccard similarity between two multi-word strings.
 */
export function calculateTokenSimilarity(str1: string, str2: string): number {
  const tokens1 = new Set(normalizeArabicForComparison(str1).split(' ').filter(Boolean));
  const tokens2 = new Set(normalizeArabicForComparison(str2).split(' ').filter(Boolean));

  if (!tokens1.size || !tokens2.size) return 0;

  let intersection = 0;
  tokens1.forEach((t) => {
    if (tokens2.has(t)) intersection++;
  });

  const union = new Set([...tokens1, ...tokens2]).size;
  return Math.round((intersection / union) * 100);
}

export interface FuzzyOptions<T = any> {
  extractCode?: (item: T) => string | undefined;
  extractName?: (item: T) => string | undefined;
  minConfidence?: number;
  maxResults?: number;
  domainLabelAr?: string;
  domainLabelEn?: string;
  approvedMappings?: Record<string, string>;
}

/**
 * Find and rank closest Master Data candidates for an uploaded historical value.
 */
export function rankFuzzyCandidates<T = any>(
  inputValue: string | null | undefined,
  masterDataList: T[],
  optionsOrDomainAr?: FuzzyOptions<T> | string,
  domainLabelEn?: string,
  approvedMappings?: Record<string, string> // mapping from normalized input to known approved entity ID
): FuzzyCandidate<T>[] {
  if (!inputValue || !String(inputValue).trim() || !masterDataList || !masterDataList.length) {
    return [];
  }

  let options: FuzzyOptions<T> = {};
  if (typeof optionsOrDomainAr === 'string') {
    options = {
      domainLabelAr: optionsOrDomainAr,
      domainLabelEn: domainLabelEn || 'Item',
      approvedMappings,
      minConfidence: 50,
      maxResults: 10,
    };
  } else if (optionsOrDomainAr && typeof optionsOrDomainAr === 'object') {
    options = optionsOrDomainAr;
  }

  const domainLabelAr = options.domainLabelAr || 'عنصر';
  const domainEn = options.domainLabelEn || 'Item';
  const appMappings = options.approvedMappings || approvedMappings;
  const minConfidence = options.minConfidence !== undefined ? options.minConfidence : 50;
  const maxResults = options.maxResults !== undefined ? options.maxResults : 10;

  const rawInput = String(inputValue).trim();
  const normInput = normalizeArabicForComparison(rawInput);
  const normCodeInput = normalizeCodeForComparison(rawInput);

  const candidateResults: FuzzyCandidate<T>[] = [];

  for (const item of masterDataList) {
    const rawItem = item as any;
    const id = rawItem.id || '';
    const name = options.extractName ? (options.extractName(item) || '') : (rawItem.name || rawItem.fullName || rawItem.company || rawItem.carNumber || '');
    const code = options.extractCode ? (options.extractCode(item) || '') : (rawItem.code || rawItem.carNumber || '');

    const normName = normalizeArabicForComparison(name);
    const normCode = normalizeCodeForComparison(code);

    // 0. Check previously approved human mapping memory
    if (appMappings && appMappings[normInput] && appMappings[normInput] === id) {
      candidateResults.push({
        entity: item,
        id,
        code,
        name,
        confidence: 99,
        matchType: 'PREVIOUSLY_APPROVED_MAPPING',
        reasonAr: `مطابقة من سجل القرارات السابقة المعتمدة (${name})`,
        reasonEn: `Matched from previously approved mapping memory (${name})`,
        diffCount: 0,
      });
      continue;
    }

    // 1. Exact Code Match
    if (code && rawInput.toUpperCase() === code.toUpperCase()) {
      candidateResults.push({
        entity: item,
        id,
        code,
        name,
        confidence: 100,
        matchType: 'EXACT_CODE',
        reasonAr: `تطابق كود تام (100%): ${code}`,
        reasonEn: `Exact code match (100%): ${code}`,
        diffCount: 0,
      });
      continue;
    }

    // 2. Exact Name Match
    if (name && rawInput === name) {
      candidateResults.push({
        entity: item,
        id,
        code,
        name,
        confidence: 100,
        matchType: 'EXACT_NAME',
        reasonAr: `تطابق اسم تام (100%): ${name}`,
        reasonEn: `Exact name match (100%): ${name}`,
        diffCount: 0,
      });
      continue;
    }

    // 3. Normalized Name Match
    if (normName && normInput === normName) {
      candidateResults.push({
        entity: item,
        id,
        code,
        name,
        confidence: 97,
        matchType: 'NORMALIZED_NAME',
        reasonAr: `تطابق بعد التوحيد اللغوي (97%): إزالة المسافات واختلافات الهمزة`,
        reasonEn: `Normalized name match (97%): Hamza / space normalization`,
        diffCount: 0,
      });
      continue;
    }

    // 4. Normalized Code Match (e.g. 10025 vs 010025 or BAR-2501 vs BAR2501)
    if (normCode && normCodeInput === normCode) {
      candidateResults.push({
        entity: item,
        id,
        code,
        name,
        confidence: 96,
        matchType: 'CODE_SIMILARITY',
        reasonAr: `تطابق الكود بعد إزالة التنسيق والفواصل (96%): ${code}`,
        reasonEn: `Code match without formatting/hyphens (96%): ${code}`,
        diffCount: 0,
      });
      continue;
    }

    // 5. Calculate String & Token Similarity
    const { similarity: nameSimilarity, distance: nameDistance } = calculateStringSimilarity(rawInput, name);
    const tokenSim = calculateTokenSimilarity(rawInput, name);

    // Also compare code similarity if input looks like code
    let codeSimilarity = 0;
    if (normCode && normCodeInput) {
      const res = calculateStringSimilarity(normCodeInput, normCode);
      codeSimilarity = res.similarity;
    }

    const highestScore = Math.max(nameSimilarity, tokenSim, codeSimilarity);

    // Filter by minConfidence threshold
    if (highestScore >= minConfidence) {
      let matchType: MatchType = 'FUZZY_NAME';
      let reasonAr = `مطابقة تقريبية (${highestScore}%): ${nameDistance} فروق حرفية مع ${domainLabelAr}`;
      let reasonEn = `Fuzzy similarity (${highestScore}%): ${nameDistance} char diffs in ${domainEn}`;

      if (codeSimilarity > nameSimilarity) {
        matchType = 'CODE_SIMILARITY';
        reasonAr = `تشابه كود تقريبي (${codeSimilarity}%): مع كود ${code}`;
        reasonEn = `Code similarity (${codeSimilarity}%): with code ${code}`;
      } else if (normName.includes(normInput) || normInput.includes(normName)) {
        matchType = 'PARTIAL_NAME';
        reasonAr = `احتواء واشتمال جزئي في الاسم (${highestScore}%): ${name}`;
        reasonEn = `Partial name inclusion (${highestScore}%): ${name}`;
      }

      candidateResults.push({
        entity: item,
        id,
        code,
        name,
        confidence: highestScore,
        matchType,
        reasonAr,
        reasonEn,
        diffCount: nameDistance,
      });
    }
  }

  // Sort descending by confidence
  candidateResults.sort((a, b) => b.confidence - a.confidence);

  return candidateResults.slice(0, maxResults);
}

/**
 * Returns human-readable confidence classification
 */
export function getConfidenceBadge(confidence: number): {
  level: 'HIGH' | 'MEDIUM' | 'LOW';
  labelAr: string;
  labelEn: string;
  colorClass: string;
} {
  if (confidence >= 90) {
    return {
      level: 'HIGH',
      labelAr: 'مطابقة عالية وموثوقة',
      labelEn: 'High Confidence',
      colorClass: 'bg-emerald-100 text-emerald-800 border-emerald-300',
    };
  }
  if (confidence >= 75) {
    return {
      level: 'MEDIUM',
      labelAr: 'مطابقة متوسطة (تحتاج تأكيد)',
      labelEn: 'Medium Confidence',
      colorClass: 'bg-amber-100 text-amber-800 border-amber-300',
    };
  }
  return {
    level: 'LOW',
    labelAr: 'مطابقة ضعيفة (مراجعة يدوية)',
    labelEn: 'Low Confidence',
    colorClass: 'bg-rose-100 text-rose-800 border-rose-300',
  };
}

export type ProposedMatchCandidate<T = any> = FuzzyCandidate<T>;

export function findBestFuzzyCandidates<T = any>(
  inputValue: string | null | undefined,
  masterDataList: T[],
  optionsOrDomainAr?: FuzzyOptions<T> | string,
  domainLabelEn?: string,
  approvedMappings?: Record<string, string>
): ProposedMatchCandidate<T>[] {
  return rankFuzzyCandidates(inputValue, masterDataList, optionsOrDomainAr, domainLabelEn, approvedMappings);
}



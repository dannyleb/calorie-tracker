// Types and helpers shared by the app (src/) and the API (functions/).

export const NUTRIENT_KEYS = [
  'calories',
  'protein',
  'carbs',
  'fat',
  'satFat',
  'transFat',
  'cholesterol',
  'fiber',
  'solubleFiber',
  'sugar',
  'sodium',
] as const;

export type NutrientKey = (typeof NUTRIENT_KEYS)[number];
export type Nutrients = Record<NutrientKey, number>;

export const NUTRIENT_INFO: Record<NutrientKey, { label: string; short: string; unit: string }> = {
  calories: { label: 'Calories', short: 'Cal', unit: 'kcal' },
  protein: { label: 'Protein', short: 'Protein', unit: 'g' },
  carbs: { label: 'Carbs', short: 'Carbs', unit: 'g' },
  fat: { label: 'Fat', short: 'Fat', unit: 'g' },
  satFat: { label: 'Saturated fat', short: 'Sat fat', unit: 'g' },
  transFat: { label: 'Trans fat', short: 'Trans', unit: 'g' },
  cholesterol: { label: 'Cholesterol', short: 'Chol', unit: 'mg' },
  fiber: { label: 'Fiber', short: 'Fiber', unit: 'g' },
  solubleFiber: { label: 'Soluble fiber', short: 'Sol. fiber', unit: 'g' },
  sugar: { label: 'Sugar', short: 'Sugar', unit: 'g' },
  sodium: { label: 'Sodium', short: 'Sodium', unit: 'mg' },
};

export type FoodSource = 'usda' | 'label' | 'barcode' | 'ai' | 'recipe';

/** One loggable food. Nutrients are for exactly one `unit`. */
export interface FoodItem {
  name: string;
  brand?: string;
  /** Human description of one unit, e.g. "1 medium (118 g)". */
  unit: string;
  /** Grams in one unit, when known. Lets the user enter amounts in grams. */
  unitGrams: number | null;
  perUnit: Nutrients;
  source: FoodSource;
  /** e.g. "USDA SR Legacy: Bananas, raw" */
  sourceDetail?: string;
  confidence?: 'high' | 'medium' | 'low';
  /** Nutrients the data source did not report (shown as 0 in totals). */
  missing?: NutrientKey[];
}

export interface AnalyzeResponse {
  kind: 'food' | 'nutrition_label' | 'packaged_product' | 'not_food';
  note: string;
  items: FoodItem[];
  /** Recipe mode only: name and servings if the user said them or the photo shows them. */
  recipeName?: string;
  servings?: number;
}

/** 'log' = what I ate; 'recipe' = ingredients going into a recipe. */
export type AnalyzeMode = 'log' | 'recipe';

export interface BarcodeResponse {
  found: boolean;
  code: string;
  food?: FoodItem;
}

export interface AmountResponse {
  multiplier: number;
  note: string;
}

export function emptyNutrients(): Nutrients {
  const n = {} as Nutrients;
  for (const k of NUTRIENT_KEYS) n[k] = 0;
  return n;
}

export function scaleNutrients(n: Nutrients, factor: number): Nutrients {
  const out = {} as Nutrients;
  for (const k of NUTRIENT_KEYS) out[k] = (n[k] || 0) * factor;
  return out;
}

export function addInto(target: Nutrients, n: Nutrients): Nutrients {
  for (const k of NUTRIENT_KEYS) target[k] += n[k] || 0;
  return target;
}

/** Coerce anything to a finite, non-negative number. */
export function num(v: unknown): number {
  const x = typeof v === 'string' ? parseFloat(v) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(x) && x > 0 ? x : 0;
}

// ---- Sanitizing data from outside (AI, food databases, backup files) ----

/** Highest believable value per 100 g. Anything above is bad data and treated as missing. */
export const MAX_PER_100G: Record<NutrientKey, number> = {
  calories: 900, // pure fat
  protein: 100,
  carbs: 100,
  fat: 100,
  satFat: 100,
  transFat: 100,
  cholesterol: 3500, // mg; brain ~3,000, egg yolk ~1,100
  fiber: 100,
  solubleFiber: 100,
  sugar: 100,
  sodium: 40000, // mg; table salt ~38,800
};

/** Heaviest believable single unit: a big-batch recipe ingredient (e.g. a 10 kg sack of flour). */
export const MAX_UNIT_GRAMS = 20000;

/** Highest believable value for one unit, i.e. MAX_UNIT_GRAMS of the densest food. */
const MAX_PER_UNIT: Record<NutrientKey, number> = {
  calories: 180000,
  protein: 20000,
  carbs: 20000,
  fat: 20000,
  satFat: 20000,
  transFat: 20000,
  cholesterol: 700000,
  fiber: 20000,
  solubleFiber: 20000,
  sugar: 20000,
  sodium: 8000000,
};

/** Plain text: no control characters, trimmed, length-capped. */
export function cleanText(v: unknown, max: number): string {
  if (typeof v !== 'string') return '';
  return v.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, ' ').trim().slice(0, max);
}

export function sanitizeNutrients(raw: Partial<Record<NutrientKey, unknown>> | undefined): Nutrients {
  const out = emptyNutrients();
  if (!raw || typeof raw !== 'object') return out;
  for (const k of NUTRIENT_KEYS) out[k] = Math.min(num(raw[k]), MAX_PER_UNIT[k]);
  return out;
}

const SOURCES: FoodSource[] = ['usda', 'label', 'barcode', 'ai', 'recipe'];
const CONFIDENCE = ['high', 'medium', 'low'] as const;

/** Rebuild a FoodItem from untrusted input, keeping only well-formed fields. Returns null if unusable. */
export function sanitizeFood(raw: unknown): FoodItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const f = raw as Record<string, unknown>;
  const name = cleanText(f.name, 100);
  if (!name) return null;
  const grams = Math.min(num(f.unitGrams), MAX_UNIT_GRAMS);
  const food: FoodItem = {
    name,
    unit: cleanText(f.unit, 120) || '1 serving',
    unitGrams: grams || null,
    perUnit: sanitizeNutrients(f.perUnit as Record<NutrientKey, unknown>),
    source: SOURCES.includes(f.source as FoodSource) ? (f.source as FoodSource) : 'ai',
  };
  const brand = cleanText(f.brand, 80);
  if (brand) food.brand = brand;
  const detail = cleanText(f.sourceDetail, 200);
  if (detail) food.sourceDetail = detail;
  if (CONFIDENCE.includes(f.confidence as (typeof CONFIDENCE)[number])) food.confidence = f.confidence as FoodItem['confidence'];
  if (Array.isArray(f.missing)) {
    const missing = f.missing.filter((k): k is NutrientKey => NUTRIENT_KEYS.includes(k as NutrientKey));
    if (missing.length) food.missing = [...new Set(missing)];
  }
  return food;
}

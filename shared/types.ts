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

export type FoodSource = 'usda' | 'label' | 'barcode' | 'ai';

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
}

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

export function sanitizeNutrients(raw: Partial<Record<NutrientKey, unknown>> | undefined): Nutrients {
  const out = emptyNutrients();
  if (!raw) return out;
  for (const k of NUTRIENT_KEYS) out[k] = num(raw[k]);
  return out;
}

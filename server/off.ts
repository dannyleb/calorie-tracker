// Open Food Facts (https://openfoodfacts.github.io/openfoodfacts-server/api/)
// Free, crowd-sourced. Used as a backup when USDA has no match for a barcode.

import { MAX_PER_100G, NUTRIENT_KEYS } from '../shared/types';
import type { PartialNutrients } from './usda';
import { codeVariants, stripZeros } from './usda';
import { fetchWithTimeout } from './http';

const FIELDS = 'code,product_name,brands,nutriments,serving_size,serving_quantity';
const USER_AGENT = 'CalorieTracker/0.1 (https://github.com/dannyleb/calorie-tracker)';

export interface OffProduct {
  code?: string;
  product_name?: string;
  brands?: string;
  serving_size?: string;
  serving_quantity?: number | string;
  nutriments?: Record<string, number | string | undefined>;
}

const n = (v: unknown): number | undefined => {
  const x = typeof v === 'string' ? parseFloat(v) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(x) && x >= 0 ? x : undefined;
};

/** Per-100 g nutrients. OFF stores cholesterol and sodium in grams; we convert to mg. */
export function offPer100g(p: OffProduct): PartialNutrients {
  const m = p.nutriments ?? {};
  const out: PartialNutrients = {};
  const kcal = n(m['energy-kcal_100g']);
  const kj = n(m['energy-kj_100g']) ?? n(m['energy_100g']);
  if (kcal !== undefined) out.calories = kcal;
  else if (kj !== undefined) out.calories = kj / 4.184;
  const grams: [keyof PartialNutrients, string][] = [
    ['protein', 'proteins_100g'],
    ['carbs', 'carbohydrates_100g'],
    ['fat', 'fat_100g'],
    ['satFat', 'saturated-fat_100g'],
    ['transFat', 'trans-fat_100g'],
    ['fiber', 'fiber_100g'],
    ['solubleFiber', 'soluble-fiber_100g'],
    ['sugar', 'sugars_100g'],
  ];
  for (const [key, field] of grams) {
    const v = n(m[field]);
    if (v !== undefined) out[key] = v;
  }
  const chol = n(m['cholesterol_100g']);
  if (chol !== undefined) out.cholesterol = chol * 1000;
  const sodium = n(m['sodium_100g']);
  const salt = n(m['salt_100g']);
  if (sodium !== undefined) out.sodium = sodium * 1000;
  else if (salt !== undefined) out.sodium = (salt / 2.5) * 1000;
  // Crowd-sourced data: drop values that can't be real.
  for (const k of NUTRIENT_KEYS) {
    const v = out[k];
    if (v !== undefined && !(v <= MAX_PER_100G[k])) delete out[k];
  }
  return out;
}

export async function findOff(code: string): Promise<OffProduct | null> {
  // OFF keys products by EAN-13 (UPC-A gets a leading 0); try that spelling first.
  const variants = codeVariants(code);
  const ordered = [...variants.filter((v) => v.length === 13), ...variants.filter((v) => v.length !== 13)];
  for (const v of ordered.slice(0, 2)) {
    const res = await fetchWithTimeout(
      `https://world.openfoodfacts.org/api/v2/product/${v}.json?fields=${FIELDS}`,
      { headers: { 'user-agent': USER_AGENT, accept: 'application/json' } },
    );
    if (res.status === 404) continue;
    if (!res.ok) throw new Error(`Open Food Facts failed: ${res.status}`);
    const data = (await res.json()) as { status?: number; product?: OffProduct };
    if (data.status === 1 && data.product && stripZeros(data.product.code ?? v) === stripZeros(v)) {
      return data.product;
    }
  }
  return null;
}

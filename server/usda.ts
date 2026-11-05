// USDA FoodData Central (https://fdc.nal.usda.gov/api-guide)
// All FDC nutrient values in search results are per 100 g (or 100 ml).

import { MAX_PER_100G, NUTRIENT_KEYS, type NutrientKey } from '../shared/types';
import { fetchWithTimeout } from './http';

const SEARCH_URL = 'https://api.nal.usda.gov/fdc/v1/foods/search';

// FDC nutrient numbers. Energy has three variants depending on data type.
const NUTRIENT_NUMBERS: Record<NutrientKey, string[]> = {
  calories: ['208', '958', '957'],
  protein: ['203'],
  carbs: ['205'],
  fat: ['204'],
  satFat: ['606'],
  transFat: ['605'],
  cholesterol: ['601'],
  fiber: ['291'],
  solubleFiber: ['295'],
  sugar: ['269', '269.3'],
  sodium: ['307'],
};

export interface FdcNutrient {
  nutrientId?: number;
  nutrientNumber?: string;
  nutrientName?: string;
  unitName?: string;
  value?: number;
}

export interface FdcFood {
  fdcId: number;
  description: string;
  dataType?: string;
  gtinUpc?: string;
  brandOwner?: string;
  brandName?: string;
  servingSize?: number;
  servingSizeUnit?: string;
  householdServingFullText?: string;
  foodNutrients?: FdcNutrient[];
}

export type PartialNutrients = Partial<Record<NutrientKey, number>>;

/** Per-100 g nutrients from an FDC search hit. Keys absent from the record are left out. */
export function per100g(food: FdcFood): PartialNutrients {
  const byNumber = new Map<string, number>();
  for (const n of food.foodNutrients ?? []) {
    if (n.nutrientNumber && typeof n.value === 'number' && Number.isFinite(n.value)) {
      // Skip kJ energy entries; we only want kcal.
      if (n.unitName && n.unitName.toUpperCase() === 'KJ') continue;
      if (!byNumber.has(n.nutrientNumber)) byNumber.set(n.nutrientNumber, n.value);
    }
  }
  const out: PartialNutrients = {};
  for (const key of NUTRIENT_KEYS) {
    for (const num of NUTRIENT_NUMBERS[key]) {
      const v = byNumber.get(num);
      if (v !== undefined) {
        // Out-of-range values are bad data: leave the nutrient missing.
        if (v >= 0 && v <= MAX_PER_100G[key]) out[key] = v;
        break;
      }
    }
  }
  return out;
}

async function search(apiKey: string, body: Record<string, unknown>): Promise<FdcFood[]> {
  // Key goes in a header (supported by api.data.gov) so it never appears in URLs or logs.
  const res = await fetchWithTimeout(SEARCH_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`USDA search failed: ${res.status}`);
  const data = (await res.json()) as { foods?: FdcFood[] };
  return data.foods ?? [];
}

/** Generic (non-branded) foods: whole foods and common dishes. */
export function searchGeneric(query: string, apiKey: string): Promise<FdcFood[]> {
  return search(apiKey, {
    query,
    dataType: ['Foundation', 'SR Legacy', 'Survey (FNDDS)'],
    pageSize: 6,
  });
}

/** Expand an 8-digit UPC-E code to its 12-digit UPC-A form. */
export function upcEtoA(code: string): string | null {
  if (!/^[01]\d{7}$/.test(code)) return null;
  const ns = code[0];
  const d = code.slice(1, 7);
  const check = code[7];
  const last = d[5];
  let body: string;
  if (last === '0' || last === '1' || last === '2') body = d[0] + d[1] + last + '0000' + d[2] + d[3] + d[4];
  else if (last === '3') body = d[0] + d[1] + d[2] + '00000' + d[3] + d[4];
  else if (last === '4') body = d[0] + d[1] + d[2] + d[3] + '00000' + d[4];
  else body = d[0] + d[1] + d[2] + d[3] + d[4] + '0000' + last;
  return ns + body + check;
}

export const stripZeros = (s: string) => s.replace(/^0+/, '');

/** Spellings of the same code that databases may store (UPC-A vs EAN-13 vs GTIN-14). */
export function codeVariants(code: string): string[] {
  const base = (code.length === 8 && upcEtoA(code)) || code;
  const core = stripZeros(base);
  const out = new Set<string>([base]);
  for (const len of [12, 13, 14]) if (core.length <= len) out.add(core.padStart(len, '0'));
  return [...out];
}

export async function findBranded(code: string, apiKey: string): Promise<FdcFood | null> {
  const variants = codeVariants(code);
  const target = stripZeros(variants[0]);
  for (const v of variants.slice(0, 3)) {
    const foods = await search(apiKey, { query: v, dataType: ['Branded'], pageSize: 5 });
    const hit = foods.find((f) => f.gtinUpc && stripZeros(f.gtinUpc) === target);
    if (hit) return hit;
  }
  return null;
}

export function titleCase(s: string): string {
  if (s !== s.toUpperCase()) return s; // already mixed case
  return s.toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase());
}

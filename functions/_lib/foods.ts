import {
  NUTRIENT_KEYS,
  emptyNutrients,
  num,
  sanitizeNutrients,
  type FoodItem,
  type NutrientKey,
  type Nutrients,
} from '../../shared/types';
import type { FdcFood, PartialNutrients } from './usda';
import { per100g, searchGeneric, titleCase } from './usda';
import { offPer100g, type OffProduct } from './off';

const round1 = (x: number) => Math.round(x * 10) / 10;

export function fmtGrams(g: number): string {
  return g >= 10 ? `${Math.round(g)} g` : `${round1(g)} g`;
}

/** Scale per-100 g values to `grams`; report which nutrients were absent. */
export function scalePer100(p: PartialNutrients, grams: number): { values: Nutrients; missing: NutrientKey[] } {
  const values = emptyNutrients();
  const missing: NutrientKey[] = [];
  for (const k of NUTRIENT_KEYS) {
    const v = p[k];
    if (v === undefined) missing.push(k);
    else values[k] = (v * grams) / 100;
  }
  return { values, missing };
}

/** USDA kcal should be in the same ballpark as Claude's own estimate, or the match is probably wrong. */
export function plausible(usdaKcal: number | undefined, aiKcal: number): boolean {
  if (usdaKcal === undefined) return false;
  if (aiKcal < 30) return usdaKcal < 80;
  const ratio = usdaKcal / aiKcal;
  return ratio >= 0.5 && ratio <= 2;
}

/** Raw item shape returned by Claude (see ANALYZE_SCHEMA). */
export interface RawItem {
  name: string;
  amount: string;
  grams: number;
  from_label: boolean;
  usda_query: string;
  confidence: 'high' | 'medium' | 'low';
  nutrients: Record<NutrientKey, number>;
}

/**
 * Turn one AI-identified item into a FoodItem.
 * Label values are used as-is. Otherwise nutrients come from USDA when a sensible
 * match exists (filling gaps with the AI estimate), else from the AI estimate.
 */
export async function resolveItem(raw: RawItem, usdaKey: string | undefined): Promise<FoodItem> {
  const grams = num(raw.grams);
  const ai = sanitizeNutrients(raw.nutrients);
  const amount = (raw.amount || '1 serving').trim();
  const unit = grams && !/\d\s*g\b/i.test(amount) ? `${amount} · ${fmtGrams(grams)}` : amount;
  const base = {
    name: (raw.name || 'Food').trim(),
    unit,
    unitGrams: grams || null,
    confidence: raw.confidence,
  };

  if (raw.from_label) {
    return { ...base, perUnit: ai, source: 'label', sourceDetail: 'Read from the nutrition label' };
  }

  const query = raw.usda_query?.trim();
  if (query && grams && usdaKey) {
    try {
      const hits = await searchGeneric(query, usdaKey);
      for (const hit of hits.slice(0, 4)) {
        const p = per100g(hit);
        const { values, missing } = scalePer100(p, grams);
        if (!plausible(p.calories === undefined ? undefined : values.calories, ai.calories)) continue;
        // Fill nutrients USDA didn't report with the AI estimate.
        for (const k of missing) values[k] = ai[k];
        return {
          ...base,
          perUnit: values,
          source: 'usda',
          sourceDetail: `USDA ${hit.dataType ?? ''}: ${hit.description}`.replace('  ', ' '),
        };
      }
    } catch (err) {
      console.warn('USDA lookup failed, using AI estimate', err);
    }
  }

  return { ...base, perUnit: ai, source: 'ai', sourceDetail: 'AI estimate' };
}

function servingGrams(size: number | undefined, unit: string | undefined): number | null {
  const s = num(size);
  if (!s) return null;
  const u = (unit || '').toLowerCase();
  if (['g', 'grm', 'gram', 'grams', 'ml', 'mlt', 'mL'].includes(u) || u === '') return s;
  if (u === 'oz' || u === 'onz') return s * 28.35;
  return null;
}

export function foodFromFdc(food: FdcFood): FoodItem {
  const p = per100g(food);
  const g = servingGrams(food.servingSize, food.servingSizeUnit);
  const grams = g ?? 100;
  const { values, missing } = scalePer100(p, grams);
  const household = food.householdServingFullText?.trim();
  const unit = g
    ? household
      ? `1 serving (${household}, ${fmtGrams(g)})`
      : `1 serving (${fmtGrams(g)})`
    : '100 g';
  return {
    name: titleCase(food.description || 'Packaged food'),
    brand: food.brandName ? titleCase(food.brandName) : food.brandOwner ? titleCase(food.brandOwner) : undefined,
    unit,
    unitGrams: grams,
    perUnit: values,
    source: 'barcode',
    sourceDetail: `USDA Branded #${food.fdcId}`,
    missing: missing.filter((k) => k !== 'solubleFiber'),
  };
}

export function foodFromOff(p: OffProduct): FoodItem {
  const per = offPer100g(p);
  const g = num(p.serving_quantity) || null;
  const grams = g ?? 100;
  const { values, missing } = scalePer100(per, grams);
  const size = p.serving_size?.trim();
  return {
    name: (p.product_name || 'Packaged food').trim(),
    brand: p.brands?.split(',')[0]?.trim() || undefined,
    unit: g ? `1 serving (${size || fmtGrams(g)})` : '100 g',
    unitGrams: grams,
    perUnit: values,
    source: 'barcode',
    sourceDetail: `Open Food Facts #${p.code ?? ''}`,
    missing: missing.filter((k) => k !== 'solubleFiber'),
  };
}

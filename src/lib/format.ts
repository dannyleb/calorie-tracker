import { NUTRIENT_INFO, type FoodItem, type NutrientKey } from '../../shared/types';

/** Value without unit: 1,240 kcal / 13.4 g / 245 mg */
export function fmtValue(key: NutrientKey, v: number): string {
  if (!Number.isFinite(v)) return '0';
  const unit = NUTRIENT_INFO[key].unit;
  if (unit === 'kcal' || unit === 'mg') return Math.round(v).toLocaleString();
  if (v >= 100) return Math.round(v).toLocaleString();
  if (v >= 10) return (Math.round(v * 2) / 2).toLocaleString(); // nearest 0.5
  return (Math.round(v * 10) / 10).toLocaleString();
}

export function fmtNutrient(key: NutrientKey, v: number): string {
  return `${fmtValue(key, v)} ${NUTRIENT_INFO[key].unit}`;
}

export function fmtQty(q: number): string {
  const fractions: [number, string][] = [
    [0.25, '¼'],
    [1 / 3, '⅓'],
    [0.5, '½'],
    [2 / 3, '⅔'],
    [0.75, '¾'],
  ];
  const whole = Math.floor(q + 1e-9);
  const frac = q - whole;
  if (frac < 0.02) return String(whole);
  for (const [v, s] of fractions) if (Math.abs(frac - v) < 0.02) return whole ? `${whole}${s}` : s;
  return String(Math.round(q * 100) / 100);
}

/** "1 medium · 118 g" or "1½ × 1 medium · 118 g (177 g)" */
export function describeAmount(food: FoodItem, qty: number): string {
  if (Math.abs(qty - 1) < 1e-6) return food.unit;
  const grams = food.unitGrams ? ` (${Math.round(food.unitGrams * qty)} g)` : '';
  return `${fmtQty(qty)} × ${food.unit}${grams}`;
}

export const SOURCE_LABEL: Record<FoodItem['source'], string> = {
  usda: 'USDA',
  label: 'Label',
  barcode: 'Barcode',
  ai: 'AI estimate',
};

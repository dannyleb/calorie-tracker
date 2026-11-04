import { describe, expect, it } from 'vitest';
import { foodFromFdc, foodFromOff, plausible, resolveItem, scalePer100 } from '../server/foods';
import { offPer100g } from '../server/off';
import { codeVariants, per100g, titleCase, upcEtoA, type FdcFood } from '../server/usda';
import { parseAmountLocal } from '../src/lib/amount';
import { describeAmount, fmtQty, fmtValue } from '../src/lib/format';
import { buckets, periodRange, summarize, topContributors, totalsByDay } from '../src/lib/stats';
import type { Entry } from '../src/lib/db';
import { emptyNutrients, type FoodItem } from '../shared/types';

const nut = (number: string, value: number, unitName = 'G') => ({ nutrientNumber: number, value, unitName });

const BANANA: FdcFood = {
  fdcId: 173944,
  description: 'Bananas, raw',
  dataType: 'SR Legacy',
  foodNutrients: [
    nut('208', 89, 'KCAL'),
    nut('268', 371, 'kJ'),
    nut('203', 1.09),
    nut('204', 0.33),
    nut('205', 22.84),
    nut('291', 2.6),
    nut('269', 12.23),
    nut('307', 1, 'MG'),
    nut('601', 0, 'MG'),
    nut('606', 0.112),
  ],
};

describe('USDA parsing', () => {
  it('maps nutrient numbers to per-100 g values and skips kJ', () => {
    const p = per100g(BANANA);
    expect(p.calories).toBe(89);
    expect(p.satFat).toBe(0.112);
    expect(p.cholesterol).toBe(0);
    expect(p.transFat).toBeUndefined();
  });

  it('uses Atwater energy when 208 is absent (Foundation foods)', () => {
    const p = per100g({ fdcId: 1, description: 'x', foodNutrients: [nut('958', 61, 'KCAL')] });
    expect(p.calories).toBe(61);
  });

  it('scales to grams and reports missing nutrients', () => {
    const { values, missing } = scalePer100(per100g(BANANA), 118);
    expect(values.calories).toBeCloseTo(105.02, 1);
    expect(missing).toContain('transFat');
    expect(missing).not.toContain('calories');
  });

  it('builds a branded food from a serving size', () => {
    const f = foodFromFdc({
      fdcId: 5,
      description: 'HONEY NUT CHEERIOS',
      dataType: 'Branded',
      brandName: 'CHEERIOS',
      gtinUpc: '016000275270',
      servingSize: 37,
      servingSizeUnit: 'g',
      householdServingFullText: '1 cup',
      foodNutrients: [nut('208', 378, 'KCAL'), nut('606', 1.35), nut('601', 0, 'MG')],
    });
    expect(f.name).toBe('Honey Nut Cheerios');
    expect(f.brand).toBe('Cheerios');
    expect(f.unitGrams).toBe(37);
    expect(f.perUnit.calories).toBeCloseTo(139.9, 1);
    expect(f.unit).toBe('1 serving (1 cup, 37 g)');
  });

  it('title-cases only all-caps text', () => {
    expect(titleCase('PEANUT BUTTER')).toBe('Peanut Butter');
    expect(titleCase('Peanut butter')).toBe('Peanut butter');
  });
});

describe('barcodes', () => {
  it('expands UPC-E to UPC-A', () => {
    expect(upcEtoA('04252614')).toBe('042100005264');
    expect(upcEtoA('01234565')).toBe('012345000065');
  });

  it('produces UPC-A / EAN-13 / GTIN-14 spellings', () => {
    expect(codeVariants('016000275270')).toEqual(['016000275270', '0016000275270', '00016000275270']);
    expect(codeVariants('0016000275270')).toContain('016000275270');
  });
});

describe('Open Food Facts parsing', () => {
  it('converts cholesterol and sodium from g to mg', () => {
    const p = offPer100g({
      nutriments: { 'energy-kcal_100g': 250, 'cholesterol_100g': 0.015, 'sodium_100g': 0.4, 'saturated-fat_100g': '3.1' },
    });
    expect(p.cholesterol).toBeCloseTo(15);
    expect(p.sodium).toBeCloseTo(400);
    expect(p.satFat).toBeCloseTo(3.1);
  });

  it('derives sodium from salt and kcal from kJ when needed', () => {
    const p = offPer100g({ nutriments: { energy_100g: 418.4, salt_100g: 1 } });
    expect(p.calories).toBeCloseTo(100);
    expect(p.sodium).toBeCloseTo(400);
  });

  it('uses serving_quantity for the unit', () => {
    const f = foodFromOff({ code: '123', product_name: 'Oat milk', brands: 'Oatly,Other', serving_size: '240 ml', serving_quantity: 240, nutriments: { 'energy-kcal_100g': 50 } });
    expect(f.brand).toBe('Oatly');
    expect(f.perUnit.calories).toBeCloseTo(120);
    expect(f.unit).toBe('1 serving (240 ml)');
  });
});

describe('AI + USDA merge', () => {
  it('rejects a USDA match whose calories disagree wildly', () => {
    expect(plausible(105, 100)).toBe(true);
    expect(plausible(400, 100)).toBe(false);
    expect(plausible(10, 5)).toBe(true);
    expect(plausible(undefined, 100)).toBe(false);
  });

  it('keeps label values as-is without a USDA call', async () => {
    const f = await resolveItem(
      {
        name: 'Granola',
        amount: '2/3 cup',
        grams: 55,
        from_label: true,
        usda_query: '',
        confidence: 'high',
        nutrients: { ...emptyNutrients(), calories: 240, satFat: 1.5 },
      },
      'key',
    );
    expect(f.source).toBe('label');
    expect(f.perUnit.calories).toBe(240);
    expect(f.unit).toBe('2/3 cup · 55 g');
  });

  it('falls back to the AI estimate when there is no USDA key', async () => {
    const f = await resolveItem(
      { name: 'Banana', amount: '1 medium', grams: 118, from_label: false, usda_query: 'Bananas, raw', confidence: 'high', nutrients: { ...emptyNutrients(), calories: 105 } },
      undefined,
    );
    expect(f.source).toBe('ai');
    expect(f.unitGrams).toBe(118);
  });
});

describe('amount parsing', () => {
  it('handles numbers, fractions and words', () => {
    expect(parseAmountLocal('2', 100)).toBe(2);
    expect(parseAmountLocal('1/2', 100)).toBe(0.5);
    expect(parseAmountLocal('1 1/2', 100)).toBe(1.5);
    expect(parseAmountLocal('½', 100)).toBe(0.5);
    expect(parseAmountLocal('1½', 100)).toBe(1.5);
    expect(parseAmountLocal('half', 100)).toBe(0.5);
    expect(parseAmountLocal('a half', 100)).toBe(0.5);
    expect(parseAmountLocal('two', 100)).toBe(2);
    expect(parseAmountLocal('two and a half', 100)).toBe(2.5);
    expect(parseAmountLocal('2x', 100)).toBe(2);
    expect(parseAmountLocal('x 3', 100)).toBe(3);
    expect(parseAmountLocal('2 servings', 100)).toBe(2);
    expect(parseAmountLocal('Double', 100)).toBe(2);
  });

  it('converts grams and ounces when the unit weight is known', () => {
    expect(parseAmountLocal('150 g', 100)).toBe(1.5);
    expect(parseAmountLocal('150g', 100)).toBe(1.5);
    expect(parseAmountLocal('200 grams', 50)).toBe(4);
    expect(parseAmountLocal('4 oz', 113.4)).toBeCloseTo(1, 2);
    expect(parseAmountLocal('150 g', null)).toBeNull();
  });

  it('leaves anything else to the AI', () => {
    expect(parseAmountLocal('half a cup', 100)).toBeNull();
    expect(parseAmountLocal('a big bowl', 100)).toBeNull();
    expect(parseAmountLocal('2 eggs', 100)).toBeNull();
    expect(parseAmountLocal('', 100)).toBeNull();
  });
});

describe('formatting', () => {
  it('formats quantities as fractions', () => {
    expect(fmtQty(1)).toBe('1');
    expect(fmtQty(0.5)).toBe('½');
    expect(fmtQty(1.5)).toBe('1½');
    expect(fmtQty(0.75)).toBe('¾');
    expect(fmtQty(1.37)).toBe('1.37');
  });

  it('formats nutrient values by unit', () => {
    expect(fmtValue('calories', 1234.6)).toBe('1,235');
    expect(fmtValue('satFat', 3.14)).toBe('3.1');
    expect(fmtValue('satFat', 13.3)).toBe('13.5');
    expect(fmtValue('cholesterol', 45.6)).toBe('46');
  });

  it('describes amounts with grams', () => {
    const food: FoodItem = { name: 'Banana', unit: '1 medium · 118 g', unitGrams: 118, perUnit: emptyNutrients(), source: 'usda' };
    expect(describeAmount(food, 1)).toBe('1 medium · 118 g');
    expect(describeAmount(food, 1.5)).toBe('1½ × 1 medium · 118 g (177 g)');
  });
});

describe('trends', () => {
  const food = (name: string, satFat: number, calories: number): FoodItem => ({
    name,
    unit: '1 serving',
    unitGrams: null,
    perUnit: { ...emptyNutrients(), satFat, calories },
    source: 'ai',
  });
  const entry = (date: string, f: FoodItem, qty = 1): Entry => ({ id: `${date}-${f.name}-${qty}`, date, ts: 0, food: f, qty });
  const cheese = food('Cheddar', 6, 113);
  const oats = food('Oatmeal', 0.5, 150);
  const entries = [
    entry('2026-11-02', cheese, 2), // 12 g
    entry('2026-11-02', oats),
    entry('2026-11-04', cheese, 3), // 18 g
  ];

  it('rolls windows back by whole periods', () => {
    expect(periodRange('week', 0, '2026-11-04')).toEqual({ from: '2026-10-29', to: '2026-11-04' });
    expect(periodRange('week', 1, '2026-11-04')).toEqual({ from: '2026-10-22', to: '2026-10-28' });
    expect(periodRange('quarter', 0, '2026-11-04').from).toBe('2026-08-06');
  });

  it('averages over logged days and counts days over a limit', () => {
    const byDay = totalsByDay(entries);
    const s = summarize('2026-10-29', '2026-11-04', byDay, { satFat: 13, calories: 2000 });
    expect(s.loggedDays).toBe(2);
    expect(s.totalDays).toBe(7);
    expect(s.total.satFat).toBeCloseTo(30.5);
    expect(s.avg.satFat).toBeCloseTo(15.25);
    expect(s.daysOver.satFat).toBe(1);
    expect(s.daysOver.calories).toBeUndefined();
  });

  it('buckets days, weeks and 4-week blocks', () => {
    const byDay = totalsByDay(entries);
    const days = buckets('week', '2026-10-29', '2026-11-04', byDay, 'satFat');
    expect(days).toHaveLength(7);
    expect(days[4].value).toBeCloseTo(12.5);
    expect(days[5].value).toBeNull();
    const weeks = buckets('quarter', ...Object.values(periodRange('quarter', 0, '2026-11-04')) as [string, string], byDay, 'satFat');
    expect(weeks).toHaveLength(13);
    expect(weeks[12].value).toBeCloseTo(15.25);
    const blocks = buckets('year', ...Object.values(periodRange('year', 0, '2026-11-04')) as [string, string], byDay, 'satFat');
    expect(blocks).toHaveLength(13);
  });

  it('ranks top contributors', () => {
    const top = topContributors(entries, 'satFat');
    expect(top[0].name).toBe('Cheddar');
    expect(top[0].share).toBeCloseTo(30 / 30.5);
  });
});

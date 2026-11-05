import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleApi } from '../server/router';
import type { Env } from '../server/http';
import { emptyNutrients, type FoodItem } from '../shared/types';
import { parseAmountLocal } from '../src/lib/amount';
import { sanitizeRecipe } from '../src/lib/backup';
import { newRecipe, rawGrams, recipeServingFood, recipeTotal, type Recipe } from '../src/lib/recipes';

const food = (name: string, unitGrams: number | null, calories: number, satFat = 0, cholesterol = 0): FoodItem => ({
  name,
  unit: `${unitGrams ?? '?'} g`,
  unitGrams,
  perUnit: { ...emptyNutrients(), calories, satFat, cholesterol },
  source: 'usda',
});

const bread = (): Recipe => ({
  ...newRecipe('r1'),
  name: 'Banana bread',
  servings: 8,
  ingredients: [
    { id: 'a', food: food('Flour', 250, 910, 0.4), qty: 1 },
    { id: 'b', food: food('Butter', 113, 810, 51, 243), qty: 1 },
    { id: 'c', food: food('Egg', 50, 72, 1.6, 186), qty: 2 },
  ],
});

describe('recipe math', () => {
  it('totals ingredients times their quantity', () => {
    const t = recipeTotal(bread());
    expect(t.calories).toBe(910 + 810 + 144);
    expect(t.cholesterol).toBe(243 + 372);
  });

  it('builds one serving as a loggable food', () => {
    const s = recipeServingFood(bread());
    expect(s.name).toBe('Banana bread');
    expect(s.source).toBe('recipe');
    expect(s.perUnit.calories).toBeCloseTo(1864 / 8);
    expect(s.perUnit.satFat).toBeCloseTo((0.4 + 51 + 3.2) / 8);
    expect(s.unitGrams).toBeCloseTo((250 + 113 + 100) / 8);
    expect(s.unit).toBe('1 serving (of 8) · 58 g');
    expect(s.sourceDetail).toBe('Recipe · 3 ingredients');
  });

  it('uses cooked weight for grams when given', () => {
    const s = recipeServingFood({ ...bread(), cookedGrams: 400 });
    expect(s.unitGrams).toBe(50);
    expect(s.sourceDetail).toContain('cooked weight');
  });

  it('has no gram weight when an ingredient weight is unknown', () => {
    const r = bread();
    r.ingredients.push({ id: 'd', food: food('Pinch of spice', null, 0), qty: 1 });
    expect(rawGrams(r)).toBeNull();
    expect(recipeServingFood(r).unitGrams).toBeNull();
  });

  it('names untitled recipes and never divides by zero servings', () => {
    const s = recipeServingFood({ ...bread(), name: '  ', servings: 0 });
    expect(s.name).toBe('Untitled recipe');
    expect(s.perUnit.calories).toBe(1864);
  });
});

describe('amounts for ingredients', () => {
  it('reads a bare number above 20 as grams when the weight is known', () => {
    expect(parseAmountLocal('500', 30)).toBeCloseTo(16.67, 2);
    expect(parseAmountLocal('2', 30)).toBe(2);
    expect(parseAmountLocal('200', null)).toBe(200);
  });

  it('allows large batch amounts', () => {
    expect(parseAmountLocal('5000 g', 30)).toBeCloseTo(166.7, 1);
  });
});

describe('recipe backup', () => {
  it('rebuilds valid recipes and drops bad ingredients', () => {
    const r = sanitizeRecipe({
      ...bread(),
      name: 'X'.repeat(300),
      servings: 1e6,
      cookedGrams: -5,
      ingredients: [...bread().ingredients, { id: 'bad', food: { name: '' }, qty: 1 }, 'junk'],
    })!;
    expect(r.name).toHaveLength(100);
    expect(r.servings).toBe(1);
    expect(r.cookedGrams).toBeNull();
    expect(r.ingredients).toHaveLength(3);
    expect(sanitizeRecipe({ name: 'no id' })).toBeNull();
  });
});

describe('analyze in recipe mode', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('sends recipe instructions and schema, and returns name and servings', async () => {
    let sent: any = null;
    vi.stubGlobal('fetch', async (_url: string | URL | Request, init?: RequestInit) => {
      sent = JSON.parse(String(init?.body));
      const out = {
        kind: 'food',
        note: '',
        recipe_name: 'Pancakes',
        servings: 4,
        items: [
          {
            name: 'All-purpose flour',
            amount: '2 cups',
            grams: 250,
            from_label: false,
            usda_query: 'Wheat flour, white, all-purpose, enriched, bleached',
            confidence: 'high',
            nutrients: { ...emptyNutrients(), calories: 910 },
          },
        ],
      };
      return new Response(
        JSON.stringify({
          id: 'msg',
          type: 'message',
          role: 'assistant',
          model: 'claude-opus-5-5',
          content: [{ type: 'text', text: JSON.stringify(out) }],
          stop_reason: 'end_turn',
          stop_sequence: null,
          usage: { input_tokens: 1, output_tokens: 1 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });
    const env: Env = { APP_PASSCODE: 'correct horse battery staple', ANTHROPIC_API_KEY: 'k', ASSETS: { fetch: async () => new Response() } };
    const res = await handleApi(
      new Request('https://app/api/analyze', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-app-passcode': 'correct horse battery staple' },
        body: JSON.stringify({ text: '2 cups flour, 2 eggs, milk. Makes 4.', mode: 'recipe' }),
      }),
      env,
    );
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.recipeName).toBe('Pancakes');
    expect(body.servings).toBe(4);
    expect(body.items[0]).toMatchObject({ name: 'All-purpose flour', unit: '2 cups · 250 g', unitGrams: 250 });
    expect(sent.messages[0].content[0].text).toContain('ingredients of a recipe');
    expect(sent.output_config.format.schema.required).toContain('recipe_name');
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveItem } from '../server/foods';
import { findOff } from '../server/off';
import { findBranded } from '../server/usda';
import { emptyNutrients } from '../shared/types';

const nut = (nutrientNumber: string, value: number, unitName = 'G') => ({ nutrientNumber, value, unitName });

function mockFetch(handler: (url: string, body: any) => unknown) {
  const calls: { url: string; body: any; headers: Record<string, string> }[] = [];
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, body, headers: (init?.headers ?? {}) as Record<string, string> });
    const out = handler(url, body);
    if (out === 404) return new Response('{}', { status: 404 });
    return new Response(JSON.stringify(out), { status: 200, headers: { 'content-type': 'application/json' } });
  });
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

describe('USDA generic lookup', () => {
  const ai = {
    name: 'Banana',
    amount: '1 medium',
    grams: 118,
    from_label: false,
    usda_query: 'Bananas, raw',
    confidence: 'high' as const,
    nutrients: { ...emptyNutrients(), calories: 105, solubleFiber: 0.7, transFat: 0 },
  };

  it('uses the first plausible USDA match and fills gaps from the AI', async () => {
    const calls = mockFetch(() => ({
      foods: [
        // Implausible (banana chips) - should be skipped.
        { fdcId: 1, description: 'Banana chips', dataType: 'SR Legacy', foodNutrients: [nut('208', 519, 'KCAL')] },
        {
          fdcId: 173944,
          description: 'Bananas, raw',
          dataType: 'SR Legacy',
          foodNutrients: [nut('208', 89, 'KCAL'), nut('606', 0.112), nut('601', 0, 'MG'), nut('291', 2.6)],
        },
      ],
    }));
    const f = await resolveItem(ai, 'KEY');
    expect(calls[0].url).not.toContain('KEY'); // key never in the URL
    expect(calls[0].headers['x-api-key']).toBe('KEY');
    expect(calls[0].body.query).toBe('Bananas, raw');
    expect(calls[0].body.dataType).toEqual(['Foundation', 'SR Legacy', 'Survey (FNDDS)']);
    expect(f.source).toBe('usda');
    expect(f.sourceDetail).toBe('USDA SR Legacy: Bananas, raw');
    expect(f.perUnit.calories).toBeCloseTo(105.02, 1);
    expect(f.perUnit.satFat).toBeCloseTo(0.132, 2);
    expect(f.perUnit.solubleFiber).toBe(0.7); // from the AI, USDA lacked it
  });

  it('falls back to the AI estimate when nothing is plausible', async () => {
    mockFetch(() => ({ foods: [{ fdcId: 1, description: 'Banana chips', foodNutrients: [nut('208', 519, 'KCAL')] }] }));
    const f = await resolveItem(ai, 'KEY');
    expect(f.source).toBe('ai');
    expect(f.perUnit.calories).toBe(105);
  });

  it('falls back to the AI estimate when USDA errors', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new Error('network down');
    });
    const f = await resolveItem(ai, 'KEY');
    expect(f.source).toBe('ai');
  });
});

describe('barcode lookups', () => {
  it('matches a branded USDA food across UPC/EAN spellings', async () => {
    const calls = mockFetch((_url, body) =>
      body.query === '0016000275270'
        ? { foods: [{ fdcId: 9, description: 'CHEERIOS', gtinUpc: '00016000275270', foodNutrients: [] }] }
        : { foods: [{ fdcId: 8, description: 'OTHER', gtinUpc: '099999999999', foodNutrients: [] }] },
    );
    const hit = await findBranded('016000275270', 'KEY');
    expect(hit?.fdcId).toBe(9);
    expect(calls.map((c) => c.body.query)).toEqual(['016000275270', '0016000275270']);
    expect(calls[0].body.dataType).toEqual(['Branded']);
  });

  it('returns null when USDA has no exact barcode match', async () => {
    mockFetch(() => ({ foods: [{ fdcId: 8, description: 'OTHER', gtinUpc: '099999999999' }] }));
    expect(await findBranded('016000275270', 'KEY')).toBeNull();
  });

  it('queries Open Food Facts with the EAN-13 spelling first', async () => {
    const calls = mockFetch((url) =>
      url.includes('/0016000275270.json')
        ? { status: 1, product: { code: '0016000275270', product_name: 'Cheerios', nutriments: {} } }
        : 404,
    );
    const p = await findOff('016000275270');
    expect(p?.product_name).toBe('Cheerios');
    expect(calls[0].url).toContain('/0016000275270.json');
  });

  it('returns null when Open Food Facts does not know the product', async () => {
    mockFetch(() => ({ status: 0 }));
    expect(await findOff('016000275270')).toBeNull();
  });
});

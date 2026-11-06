import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyNutrients, type FoodItem } from '../shared/types';
import { allRecipes, db, logFoods, resetDbForTests } from '../src/lib/db';
import { buildCandidates, matchText, nameKey, parsePart, resolveQty, type Candidate } from '../src/lib/matcher';
import {
  normalizePhrase,
  recallAmount,
  recallBarcode,
  recallText,
  rememberAmount,
  rememberBarcode,
  rememberText,
  savedCalls,
} from '../src/lib/memory';
import { analyzeTextSmart } from '../src/lib/smart';

const food = (name: string, unit: string, unitGrams: number | null, calories: number, source: FoodItem['source'] = 'usda'): FoodItem => ({
  name,
  unit,
  unitGrams,
  perUnit: { ...emptyNutrients(), calories },
  source,
});
const BANANA = food('Banana', '1 medium · 118 g', 118, 105);
const TOAST = food('Whole wheat toast', '1 slice · 32 g', 32, 80);
const GRANOLA = food('Granola', '2/3 cup · 55 g', 55, 240, 'label');
const EGGS = food('Scrambled eggs', '2 large eggs · 120 g', 120, 200);
const MAC = food('Mac and cheese', '1 cup · 200 g', 200, 380);
const YOGURT = food('Greek yogurt', '100 g', 100, 59);

const cand = (f: FoodItem, defaultQty = 1, lastUsed = 1): Candidate => ({ food: f, defaultQty, lastUsed });
const candidates = (...cs: Candidate[]) => new Map(cs.map((c) => [nameKey(c.food.name), c]));

// Fresh database and storage for every test.
let store: Record<string, string>;
beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  resetDbForTests();
  store = { 'food-log-settings': JSON.stringify({ targets: {}, passcode: 'correct horse battery staple' }) };
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => void (store[k] = v),
    removeItem: (k: string) => void delete store[k],
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('phrase parsing', () => {
  it('normalizes text', () => {
    expect(normalizePhrase('  A Banana, please! ')).toBe('a banana please');
    expect(normalizePhrase('1.5 cups / 1/2 cup.')).toBe('1.5 cups 1/2 cup');
  });

  it('reads counts, units and food', () => {
    expect(parsePart('2 slices of toast')).toEqual({ count: 2, unit: 'slice', food: 'toast' });
    expect(parsePart('half a cup of granola')).toEqual({ count: 0.5, unit: 'cup', food: 'granola' });
    expect(parsePart('a half banana')).toEqual({ count: 0.5, unit: null, food: 'banana' });
    expect(parsePart('1 1/2 cups oats')).toEqual({ count: 1.5, unit: 'cup', food: 'oats' });
    expect(parsePart('150g chicken')).toEqual({ count: 150, unit: 'g', food: 'chicken' });
    expect(parsePart('a dozen eggs')).toEqual({ count: 12, unit: null, food: 'eggs' });
    expect(parsePart('a couple of eggs')).toEqual({ count: 2, unit: null, food: 'eggs' });
    expect(parsePart('banana')).toEqual({ count: null, unit: null, food: 'banana' });
  });

  it('compares names ignoring plurals, sizes and filler', () => {
    expect(nameKey('large bananas')).toBe('banana');
    expect(nameKey('Strawberries')).toBe(nameKey('strawberry'));
    expect(nameKey('Peaches')).toBe('peach');
    expect(nameKey('Hummus')).toBe('hummus');
  });
});

describe('amounts against a saved food', () => {
  it('uses the last amount when none is said', () => {
    expect(resolveQty(cand(BANANA, 2), parsePart('banana'))).toBe(2);
  });
  it('counts whole units', () => {
    expect(resolveQty(cand(BANANA), parsePart('2 bananas'))).toBe(2);
    expect(resolveQty(cand(TOAST), parsePart('3 slices of toast'))).toBe(3);
    expect(resolveQty(cand(EGGS), parsePart('4 scrambled eggs'))).toBe(2); // unit is 2 eggs
  });
  it('converts matching volume units', () => {
    expect(resolveQty(cand(GRANOLA), parsePart('half a cup of granola'))).toBeCloseTo(0.75);
  });
  it('converts grams and ounces when the weight is known', () => {
    expect(resolveQty(cand(BANANA), parsePart('59 g banana'))).toBeCloseTo(0.5);
    expect(resolveQty(cand(YOGURT), parsePart('150 g greek yogurt'))).toBeCloseTo(1.5);
  });
  it('refuses to guess when units differ', () => {
    expect(resolveQty(cand(BANANA), parsePart('2 cups banana'))).toBeNull();
    expect(resolveQty(cand(YOGURT), parsePart('2 greek yogurt'))).toBeNull(); // 2 what? unit is grams
    expect(resolveQty(cand(BANANA), parsePart('200 ml banana'))).toBeNull();
  });
});

describe('matching what was said', () => {
  const known = candidates(cand(BANANA), cand(TOAST), cand(GRANOLA), cand(MAC));

  it('matches every part it knows', () => {
    const m = matchText('I had 2 slices of whole wheat toast, a banana and half a cup of granola', known);
    expect(m.unmatched).toEqual([]);
    expect(m.matched.map((x) => [x.food.name, x.qty])).toEqual([
      ['Whole wheat toast', 2],
      ['Banana', 1],
      ['Granola', 0.75],
    ]);
  });

  it('needs the full saved name, so "toast" is not guessed to be whole wheat toast', () => {
    expect(matchText('2 slices of toast', known).unmatched).toEqual(['2 slices of toast']);
  });

  it('keeps saved names that contain "and"', () => {
    const m = matchText('mac and cheese', known);
    expect(m.matched[0]?.food.name).toBe('Mac and cheese');
  });

  it('handles "one and a half"', () => {
    const m = matchText('one and a half bananas', known);
    expect(m.matched[0]?.qty).toBe(1.5);
  });

  it('leaves unknown foods for the AI', () => {
    const m = matchText('a banana and a coffee with oat milk', known);
    expect(m.matched.map((x) => x.food.name)).toEqual(['Banana']);
    expect(m.unmatched).toEqual(['a coffee', 'oat milk']);
  });

  it('matches nothing with no saved foods', () => {
    expect(matchText('banana', new Map()).unmatched).toEqual(['banana']);
  });

  it('prefers the most recently used food for a name', () => {
    const older = { food: food('Banana', '1 small · 100 g', 100, 90), defaultQty: 1, lastUsed: 1 };
    const map = buildCandidates(
      [
        { key: 'a', food: older.food, lastQty: 1, lastUsed: 1, count: 1, favorite: false },
        { key: 'b', food: BANANA, lastQty: 1, lastUsed: 5, count: 1, favorite: false },
      ],
      [],
      false,
    );
    expect(map.get('banana')?.food.unit).toBe(BANANA.unit);
  });
});

describe('memory store', () => {
  it('remembers barcodes across UPC/EAN spellings', async () => {
    await rememberBarcode('016000275270', GRANOLA);
    expect((await recallBarcode('0016000275270'))?.name).toBe('Granola');
    expect(await recallBarcode('999')).toBeNull();
  });

  it('remembers phrases regardless of case and punctuation', async () => {
    await rememberText('log', 'Two eggs and toast.', { items: [{ food: EGGS, qty: 1 }], note: '' });
    expect((await recallText('log', 'two eggs and toast'))?.items[0].food.name).toBe('Scrambled eggs');
    expect(await recallText('recipe', 'two eggs and toast')).toBeNull(); // modes are separate
  });

  it('remembers amounts per food', async () => {
    await rememberAmount(GRANOLA, 'a big bowl', 2.5);
    expect(await recallAmount(GRANOLA, 'A big bowl')).toBe(2.5);
    expect(await recallAmount(BANANA, 'a big bowl')).toBeNull();
  });

  it('re-validates what it reads back', async () => {
    const d = await db();
    await d.put('memory', { key: 'barcode:123', value: { name: '', perUnit: 'x' }, createdAt: 0, lastUsed: 0, hits: 0 });
    expect(await recallBarcode('123')).toBeNull();
    await d.put('memory', { key: 'amount:x', value: 1e9, createdAt: 0, lastUsed: 0, hits: 0 });
    expect(await recallAmount(BANANA, 'x')).toBeNull();
  });

  it('upgrades a v2 database without losing data', async () => {
    const req = indexedDB.open('food-log', 2);
    req.onupgradeneeded = () => {
      const d = req.result;
      d.createObjectStore('entries', { keyPath: 'id' }).createIndex('date', 'date');
      d.createObjectStore('foods', { keyPath: 'key' });
      d.createObjectStore('recipes', { keyPath: 'id' });
    };
    const old = await new Promise<IDBDatabase>((r) => (req.onsuccess = () => r(req.result)));
    await new Promise((r) => {
      const tx = old.transaction('recipes', 'readwrite');
      tx.objectStore('recipes').put({ id: 'r1', name: 'Soup', servings: 4, cookedGrams: null, ingredients: [], createdAt: 1, updatedAt: 1 });
      tx.oncomplete = r;
    });
    old.close();
    expect((await allRecipes()).map((r) => r.name)).toEqual(['Soup']);
    await rememberBarcode('1', BANANA); // memory store exists after upgrade
    expect(await recallBarcode('1')).not.toBeNull();
  });
});

describe('"Say it" with memory', () => {
  function mockAI() {
    const calls: string[] = [];
    vi.stubGlobal('fetch', async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      calls.push(body.text);
      return new Response(
        JSON.stringify({ kind: 'food', note: '', items: [{ ...food('Coffee with oat milk', '1 cup · 240 g', 240, 45, 'ai') }] }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });
    return calls;
  }

  it('answers fully from saved foods without calling the AI', async () => {
    const calls = mockAI();
    await logFoods([{ food: BANANA, qty: 1 }, { food: TOAST, qty: 2 }], '2026-11-05');
    const before = savedCalls();
    const res = await analyzeTextSmart('a banana and 2 slices of whole wheat toast', 'log');
    expect(res.source).toBe('matched');
    expect(res.items.map((i) => [i.food.name, i.qty])).toEqual([
      ['Banana', 1],
      ['Whole wheat toast', 2],
    ]);
    expect(calls).toEqual([]);
    expect(savedCalls()).toBe(before + 1);
  });

  it('sends only the unknown part to the AI', async () => {
    const calls = mockAI();
    await logFoods([{ food: BANANA, qty: 1 }], '2026-11-05');
    const res = await analyzeTextSmart('a banana and a coffee with oat milk', 'log');
    expect(res.source).toBe('mixed');
    expect(calls).toEqual(['a coffee, oat milk']);
    expect(res.items.map((i) => i.food.name)).toEqual(['Banana', 'Coffee with oat milk']);
  });

  it('reuses a remembered phrase, and "force" still asks the AI', async () => {
    const calls = mockAI();
    await rememberText('log', 'a latte', { items: [{ food: food('Latte', '1 cup', null, 190, 'ai'), qty: 1 }], note: '' });
    expect((await analyzeTextSmart('A latte!', 'log')).source).toBe('memory');
    expect(calls).toEqual([]);
    expect((await analyzeTextSmart('a latte', 'log', true)).source).toBe('ai');
    expect(calls).toEqual(['a latte']);
  });
});

// Food memory: answers we've already paid for, kept on the phone so repeats
// don't call the AI again. Every read is re-validated, and any storage error
// just means "not remembered" so logging never breaks.

import { cleanText, sanitizeFood, type AnalyzeMode, type FoodItem } from '../../shared/types';
import { db, foodKey, type MemoryRecord } from './db';

const MAX_RECORDS = 2000;
const SAVED_KEY = 'food-log-ai-calls-saved';

export interface RememberedItem {
  food: FoodItem;
  qty: number;
}

export interface RememberedAnalysis {
  items: RememberedItem[];
  note: string;
  recipeName?: string;
  servings?: number;
}

/** Lowercase, no punctuation (keeps decimals and fractions), single spaces. */
export function normalizePhrase(s: string): string {
  return s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/(?<!\d)[./]|[./](?!\d)/g, ' ')
    .replace(/[^\p{L}\p{N}½¼¾⅓⅔./\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 1000);
}

const barcodeKey = (code: string) => `barcode:${code.replace(/^0+/, '')}`;
const textKey = (mode: AnalyzeMode, text: string) => `text:${mode}:${normalizePhrase(text)}`;
const amountKey = (food: FoodItem, text: string) => `amount:${foodKey(food)}:${normalizePhrase(text)}`;

async function recall(key: string): Promise<unknown> {
  try {
    const d = await db();
    const rec = await d.get('memory', key);
    if (!rec) return undefined;
    await d.put('memory', { ...rec, lastUsed: Date.now(), hits: rec.hits + 1 });
    return rec.value;
  } catch {
    return undefined;
  }
}

async function remember(key: string, value: unknown): Promise<void> {
  try {
    const d = await db();
    const prev = await d.get('memory', key);
    const now = Date.now();
    const rec: MemoryRecord = { key, value, createdAt: prev?.createdAt ?? now, lastUsed: now, hits: prev?.hits ?? 0 };
    await d.put('memory', rec);
    if (!prev) await prune();
  } catch {
    /* memory is best-effort */
  }
}

/** Keep the newest MAX_RECORDS entries. */
async function prune(): Promise<void> {
  const d = await db();
  const count = await d.count('memory');
  if (count <= MAX_RECORDS) return;
  let extra = count - MAX_RECORDS;
  const tx = d.transaction('memory', 'readwrite');
  let cursor = await tx.store.index('lastUsed').openCursor();
  while (cursor && extra > 0) {
    await cursor.delete();
    extra--;
    cursor = await cursor.continue();
  }
  await tx.done;
}

const validQty = (q: unknown): q is number => typeof q === 'number' && Number.isFinite(q) && q > 0 && q <= 1000;

// ---- Barcodes ----

export async function recallBarcode(code: string): Promise<FoodItem | null> {
  return sanitizeFood(await recall(barcodeKey(code)));
}

export function rememberBarcode(code: string, food: FoodItem): Promise<void> {
  return remember(barcodeKey(code), food);
}

// ---- Phrases ("2 eggs and toast") ----

export async function recallText(mode: AnalyzeMode, text: string): Promise<RememberedAnalysis | null> {
  if (!normalizePhrase(text)) return null;
  const v = (await recall(textKey(mode, text))) as Partial<RememberedAnalysis> | undefined;
  if (!v || !Array.isArray(v.items)) return null;
  const items: RememberedItem[] = [];
  for (const it of v.items) {
    const food = sanitizeFood(it?.food);
    if (food && validQty(it?.qty)) items.push({ food, qty: it.qty });
  }
  if (!items.length) return null;
  const out: RememberedAnalysis = { items, note: cleanText(v.note, 300) };
  const name = cleanText(v.recipeName, 100);
  if (name) out.recipeName = name;
  if (typeof v.servings === 'number' && Number.isInteger(v.servings) && v.servings >= 1 && v.servings <= 100) out.servings = v.servings;
  return out;
}

export function rememberText(mode: AnalyzeMode, text: string, value: RememberedAnalysis): Promise<void> {
  if (!normalizePhrase(text) || !value.items.length) return Promise.resolve();
  return remember(textKey(mode, text), value);
}

// ---- Amounts ("half a cup" of this food) ----

export async function recallAmount(food: FoodItem, text: string): Promise<number | null> {
  const v = await recall(amountKey(food, text));
  return validQty(v) ? v : null;
}

export function rememberAmount(food: FoodItem, text: string, multiplier: number): Promise<void> {
  return validQty(multiplier) ? remember(amountKey(food, text), multiplier) : Promise.resolve();
}

// ---- Stats ----

/** Record that an AI call was avoided. */
export function countSavedCall(): void {
  try {
    localStorage.setItem(SAVED_KEY, String(savedCalls() + 1));
  } catch {
    /* storage unavailable */
  }
}

export function savedCalls(): number {
  try {
    const n = Number(localStorage.getItem(SAVED_KEY));
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch {
    return 0;
  }
}

export async function memorySize(): Promise<number> {
  try {
    return await (await db()).count('memory');
  } catch {
    return 0;
  }
}

export async function clearMemory(): Promise<void> {
  await (await db()).clear('memory');
}

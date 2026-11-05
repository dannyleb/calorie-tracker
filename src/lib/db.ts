import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { FoodItem } from '../../shared/types';
import { sanitizeEntry, sanitizeRecipe, sanitizeSavedFood } from './backup';
import type { Recipe } from './recipes';
import { tsForDate } from './dates';

export interface Entry {
  id: string;
  /** Local day, YYYY-MM-DD */
  date: string;
  ts: number;
  food: FoodItem;
  /** Number of `food.unit`s eaten. */
  qty: number;
}

/** A food remembered for one-tap re-logging. */
export interface SavedFood {
  key: string;
  food: FoodItem;
  lastQty: number;
  lastUsed: number;
  count: number;
  favorite: boolean;
}

interface Schema extends DBSchema {
  entries: { key: string; value: Entry; indexes: { date: string } };
  foods: { key: string; value: SavedFood };
  recipes: { key: string; value: Recipe };
}

let dbPromise: Promise<IDBPDatabase<Schema>> | null = null;

function db() {
  // Version 2 added recipes. Upgrades only add stores; existing data is kept.
  dbPromise ??= openDB<Schema>('food-log', 2, {
    upgrade(d, oldVersion) {
      if (oldVersion < 1) {
        const entries = d.createObjectStore('entries', { keyPath: 'id' });
        entries.createIndex('date', 'date');
        d.createObjectStore('foods', { keyPath: 'key' });
      }
      if (oldVersion < 2) d.createObjectStore('recipes', { keyPath: 'id' });
    },
  });
  return dbPromise;
}

export const newId = () =>
  typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

export function foodKey(f: FoodItem): string {
  return [f.name, f.brand ?? '', f.unit].map((s) => s.trim().toLowerCase()).join('|');
}

export async function entriesForDate(date: string): Promise<Entry[]> {
  const list = await (await db()).getAllFromIndex('entries', 'date', date);
  return list.sort((a, b) => a.ts - b.ts);
}

export async function entriesInRange(from: string, to: string): Promise<Entry[]> {
  return (await db()).getAllFromIndex('entries', 'date', IDBKeyRange.bound(from, to));
}

async function remember(tx: { objectStore(name: 'foods'): any }, food: FoodItem, qty: number) {
  const store = tx.objectStore('foods');
  const key = foodKey(food);
  const prev = (await store.get(key)) as SavedFood | undefined;
  const next: SavedFood = {
    key,
    food,
    lastQty: qty,
    lastUsed: Date.now(),
    count: (prev?.count ?? 0) + 1,
    favorite: prev?.favorite ?? false,
  };
  await store.put(next);
}

/** Add foods to the log for `date`. Returns the new entry ids (for undo). */
export async function logFoods(items: { food: FoodItem; qty: number }[], date: string): Promise<string[]> {
  const d = await db();
  const tx = d.transaction(['entries', 'foods'], 'readwrite');
  const ids: string[] = [];
  const ts = tsForDate(date);
  for (const [i, { food, qty }] of items.entries()) {
    const id = newId();
    ids.push(id);
    await tx.objectStore('entries').put({ id, date, ts: ts + i, food, qty });
    await remember(tx, food, qty);
  }
  await tx.done;
  return ids;
}

export async function updateEntry(entry: Entry): Promise<void> {
  const d = await db();
  const tx = d.transaction(['entries', 'foods'], 'readwrite');
  await tx.objectStore('entries').put(entry);
  const store = tx.objectStore('foods');
  const saved = await store.get(foodKey(entry.food));
  if (saved) await store.put({ ...saved, lastQty: entry.qty });
  await tx.done;
}

export async function deleteEntries(ids: string[]): Promise<void> {
  const tx = (await db()).transaction('entries', 'readwrite');
  await Promise.all(ids.map((id) => tx.store.delete(id)));
  await tx.done;
}

export async function savedFoods(): Promise<SavedFood[]> {
  const all = await (await db()).getAll('foods');
  return all.sort((a, b) => Number(b.favorite) - Number(a.favorite) || b.lastUsed - a.lastUsed);
}

export async function isFavorite(food: FoodItem): Promise<boolean> {
  return Boolean((await (await db()).get('foods', foodKey(food)))?.favorite);
}

export async function setFavorite(food: FoodItem, favorite: boolean): Promise<void> {
  const d = await db();
  const key = foodKey(food);
  const prev = await d.get('foods', key);
  await d.put('foods', prev ? { ...prev, favorite } : { key, food, lastQty: 1, lastUsed: Date.now(), count: 0, favorite });
}

export async function forgetFood(key: string): Promise<void> {
  await (await db()).delete('foods', key);
}

export async function countEntries(): Promise<number> {
  return (await db()).count('entries');
}

// ---- Recipes ----

export async function allRecipes(): Promise<Recipe[]> {
  const list = await (await db()).getAll('recipes');
  return list.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function saveRecipe(r: Recipe): Promise<void> {
  await (await db()).put('recipes', r);
}

export async function deleteRecipe(id: string): Promise<void> {
  await (await db()).delete('recipes', id);
}

// ---- Backup ----

export interface Backup {
  app: 'food-log';
  version: 1;
  exportedAt: string;
  entries: Entry[];
  foods: SavedFood[];
  recipes?: Recipe[];
  settings?: unknown;
}

export async function exportAll(settings: unknown): Promise<Backup> {
  const d = await db();
  return {
    app: 'food-log',
    version: 1,
    exportedAt: new Date().toISOString(),
    entries: await d.getAll('entries'),
    foods: await d.getAll('foods'),
    recipes: await d.getAll('recipes'),
    settings,
  };
}

/**
 * Merge a backup into the current data (same ids are overwritten). Every record is
 * rebuilt from validated fields; malformed ones are skipped.
 */
export async function importAll(b: Backup): Promise<{ imported: number; skipped: number; recipes: number }> {
  if (b?.app !== 'food-log' || !Array.isArray(b.entries)) throw new Error('This is not a Food Log backup file.');
  const entries = b.entries.map(sanitizeEntry).filter((e): e is Entry => e !== null);
  const foods = (Array.isArray(b.foods) ? b.foods : []).map(sanitizeSavedFood).filter((f): f is SavedFood => f !== null);
  const recipes = (Array.isArray(b.recipes) ? b.recipes : []).map(sanitizeRecipe).filter((r): r is Recipe => r !== null);
  const d = await db();
  const tx = d.transaction(['entries', 'foods', 'recipes'], 'readwrite');
  for (const e of entries) await tx.objectStore('entries').put(e);
  for (const f of foods) await tx.objectStore('foods').put(f);
  for (const r of recipes) await tx.objectStore('recipes').put(r);
  await tx.done;
  return { imported: entries.length, skipped: b.entries.length - entries.length, recipes: recipes.length };
}

export async function eraseAll(): Promise<void> {
  const d = await db();
  const tx = d.transaction(['entries', 'foods', 'recipes'], 'readwrite');
  await tx.objectStore('entries').clear();
  await tx.objectStore('foods').clear();
  await tx.objectStore('recipes').clear();
  await tx.done;
}

/** Ask the browser not to evict our data under storage pressure. */
export async function requestPersistence(): Promise<void> {
  try {
    if (navigator.storage?.persist && !(await navigator.storage.persisted())) await navigator.storage.persist();
  } catch {
    /* not supported */
  }
}

import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { FoodItem } from '../../shared/types';
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
}

let dbPromise: Promise<IDBPDatabase<Schema>> | null = null;

function db() {
  dbPromise ??= openDB<Schema>('food-log', 1, {
    upgrade(d) {
      const entries = d.createObjectStore('entries', { keyPath: 'id' });
      entries.createIndex('date', 'date');
      d.createObjectStore('foods', { keyPath: 'key' });
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

export interface Backup {
  app: 'food-log';
  version: 1;
  exportedAt: string;
  entries: Entry[];
  foods: SavedFood[];
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
    settings,
  };
}

/** Merge a backup into the current data (same ids are overwritten). */
export async function importAll(b: Backup): Promise<number> {
  if (b?.app !== 'food-log' || !Array.isArray(b.entries)) throw new Error('This is not a Food Log backup file.');
  const d = await db();
  const tx = d.transaction(['entries', 'foods'], 'readwrite');
  for (const e of b.entries) if (e?.id && e.date && e.food) await tx.objectStore('entries').put(e);
  for (const f of b.foods ?? []) if (f?.key && f.food) await tx.objectStore('foods').put(f);
  await tx.done;
  return b.entries.length;
}

export async function eraseAll(): Promise<void> {
  const d = await db();
  const tx = d.transaction(['entries', 'foods'], 'readwrite');
  await tx.objectStore('entries').clear();
  await tx.objectStore('foods').clear();
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

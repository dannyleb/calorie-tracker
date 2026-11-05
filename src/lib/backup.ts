import { NUTRIENT_KEYS, cleanText, sanitizeFood, type NutrientKey } from '../../shared/types';
import type { Entry, SavedFood } from './db';
import type { Targets } from './settings';

export const MAX_BACKUP_BYTES = 50 * 1024 * 1024;

const DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const finite = (v: unknown, min: number, max: number): number | null =>
  typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : null;

/** Rebuild an entry from a backup file, or null if it isn't valid. */
export function sanitizeEntry(raw: unknown): Entry | null {
  if (!raw || typeof raw !== 'object') return null;
  const e = raw as Record<string, unknown>;
  const id = cleanText(e.id, 100);
  const date = typeof e.date === 'string' && DATE.test(e.date) ? e.date : null;
  const ts = finite(e.ts, 0, 8.64e15);
  const qty = finite(e.qty, 0.001, 100);
  const food = sanitizeFood(e.food);
  if (!id || !date || ts === null || qty === null || !food) return null;
  return { id, date, ts, qty, food };
}

export function sanitizeSavedFood(raw: unknown): SavedFood | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as Record<string, unknown>;
  const key = cleanText(s.key, 400);
  const food = sanitizeFood(s.food);
  if (!key || !food) return null;
  return {
    key,
    food,
    lastQty: finite(s.lastQty, 0.001, 100) ?? 1,
    lastUsed: finite(s.lastUsed, 0, 8.64e15) ?? 0,
    count: Math.round(finite(s.count, 0, 1e9) ?? 0),
    favorite: s.favorite === true,
  };
}

/** Only known nutrient keys with sensible numbers. */
export function sanitizeTargets(raw: unknown): Targets {
  const out: Targets = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const k of NUTRIENT_KEYS) {
    const v = finite((raw as Record<string, unknown>)[k], 0, 100000);
    if (v !== null) out[k as NutrientKey] = v;
  }
  return out;
}

import { addInto, emptyNutrients, scaleNutrients, type NutrientKey, type Nutrients } from '../../shared/types';
import { addDays, dateFromKey, daysBetween, shortDate } from './dates';
import type { Entry } from './db';
import type { Targets } from './settings';
import { targetKind } from './settings';

export const entryNutrients = (e: Entry): Nutrients => scaleNutrients(e.food.perUnit, e.qty);

export function sumEntries(entries: Entry[]): Nutrients {
  const total = emptyNutrients();
  for (const e of entries) addInto(total, entryNutrients(e));
  return total;
}

export function totalsByDay(entries: Entry[]): Map<string, Nutrients> {
  const map = new Map<string, Nutrients>();
  for (const e of entries) {
    const t = map.get(e.date) ?? emptyNutrients();
    addInto(t, entryNutrients(e));
    map.set(e.date, t);
  }
  return map;
}

export type Period = 'week' | 'month' | 'quarter' | 'year';

export const PERIOD_DAYS: Record<Period, number> = { week: 7, month: 30, quarter: 91, year: 364 };

/** Rolling window ending `offset` periods before `today`. */
export function periodRange(period: Period, offset: number, today: string): { from: string; to: string } {
  const len = PERIOD_DAYS[period];
  const to = addDays(today, -offset * len);
  return { from: addDays(to, -(len - 1)), to };
}

export interface Bucket {
  label: string;
  /** Long label for the readout, e.g. "Tue, Nov 3" or "Week of Oct 6". */
  title: string;
  from: string;
  to: string;
  /** Average per logged day in the bucket; null when nothing was logged. */
  value: number | null;
  loggedDays: number;
}

/** Chart buckets: days for week/month, weeks for quarter, ~months (4-week blocks) for year. */
export function buckets(period: Period, from: string, to: string, byDay: Map<string, Nutrients>, key: NutrientKey): Bucket[] {
  const days = daysBetween(from, to);
  const size = period === 'quarter' ? 7 : period === 'year' ? 28 : 1;
  const out: Bucket[] = [];
  for (let i = 0; i < days.length; i += size) {
    const slice = days.slice(i, i + size);
    const logged = slice.filter((d) => byDay.has(d));
    const sum = logged.reduce((acc, d) => acc + (byDay.get(d)![key] || 0), 0);
    const first = slice[0];
    const d = dateFromKey(first);
    let label: string;
    let title: string;
    if (size === 1) {
      label = period === 'week' ? d.toLocaleDateString(undefined, { weekday: 'narrow' }) : String(d.getDate());
      title = d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
    } else if (size === 7) {
      label = `${d.getMonth() + 1}/${d.getDate()}`;
      title = `Week of ${shortDate(first)}`;
    } else {
      const mid = dateFromKey(slice[Math.floor(slice.length / 2)]);
      label = mid.toLocaleDateString(undefined, { month: 'narrow' });
      title = `${shortDate(first)} – ${shortDate(slice[slice.length - 1])}`;
    }
    out.push({ label, title, from: first, to: slice[slice.length - 1], value: logged.length ? sum / logged.length : null, loggedDays: logged.length });
  }
  return out;
}

export interface PeriodSummary {
  loggedDays: number;
  totalDays: number;
  total: Nutrients;
  /** Average per logged day. */
  avg: Nutrients;
  /** Days over a limit / meeting a goal, per targeted nutrient. */
  daysOver: Partial<Record<NutrientKey, number>>;
  daysMet: Partial<Record<NutrientKey, number>>;
}

export function summarize(from: string, to: string, byDay: Map<string, Nutrients>, targets: Targets): PeriodSummary {
  const days = daysBetween(from, to).filter((d) => byDay.has(d));
  const total = emptyNutrients();
  const daysOver: PeriodSummary['daysOver'] = {};
  const daysMet: PeriodSummary['daysMet'] = {};
  for (const d of days) {
    const t = byDay.get(d)!;
    addInto(total, t);
    for (const [k, target] of Object.entries(targets) as [NutrientKey, number][]) {
      if (!target) continue;
      const kind = targetKind(k);
      if ((kind === 'limit' || kind === 'budget') && t[k] > target) daysOver[k] = (daysOver[k] ?? 0) + 1;
      if (kind === 'goal' && t[k] >= target) daysMet[k] = (daysMet[k] ?? 0) + 1;
    }
  }
  return {
    loggedDays: days.length,
    totalDays: daysBetween(from, to).length,
    total,
    avg: days.length ? scaleNutrients(total, 1 / days.length) : emptyNutrients(),
    daysOver,
    daysMet,
  };
}

export interface Contributor {
  name: string;
  value: number;
  share: number;
}

/** Foods contributing most of `key` over the entries. */
export function topContributors(entries: Entry[], key: NutrientKey, n = 5): Contributor[] {
  const map = new Map<string, number>();
  let total = 0;
  for (const e of entries) {
    const v = entryNutrients(e)[key] || 0;
    if (v <= 0) continue;
    const name = e.food.brand ? `${e.food.name} (${e.food.brand})` : e.food.name;
    map.set(name, (map.get(name) ?? 0) + v);
    total += v;
  }
  return [...map.entries()]
    .map(([name, value]) => ({ name, value, share: total ? value / total : 0 }))
    .sort((a, b) => b.value - a.value)
    .slice(0, n);
}

export function rangeLabel(from: string, to: string): string {
  const a = dateFromKey(from);
  const b = dateFromKey(to);
  const sameYear = a.getFullYear() === b.getFullYear() && b.getFullYear() === new Date().getFullYear();
  const opts: Intl.DateTimeFormatOptions = sameYear
    ? { month: 'short', day: 'numeric' }
    : { month: 'short', day: 'numeric', year: 'numeric' };
  return `${a.toLocaleDateString(undefined, opts)} – ${b.toLocaleDateString(undefined, opts)}`;
}


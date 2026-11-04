// Dates are stored as local-time keys "YYYY-MM-DD" so a day means the user's day.

const pad = (n: number) => String(n).padStart(2, '0');

export function keyFromDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function dateFromKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d, 12); // noon avoids DST edge cases
}

export const todayKey = () => keyFromDate(new Date());

export function addDays(key: string, n: number): string {
  const d = dateFromKey(key);
  d.setDate(d.getDate() + n);
  return keyFromDate(d);
}

export function daysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let k = from; k <= to; k = addDays(k, 1)) out.push(k);
  return out;
}

export function dayLabel(key: string, today = todayKey()): string {
  if (key === today) return 'Today';
  if (key === addDays(today, -1)) return 'Yesterday';
  return dateFromKey(key).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

export function shortDate(key: string): string {
  return dateFromKey(key).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function timeLabel(ts: number): string {
  return new Date(ts).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

/** Timestamp for logging onto `dateKey` at the current time of day. */
export function tsForDate(dateKey: string): number {
  const now = new Date();
  if (dateKey === keyFromDate(now)) return now.getTime();
  const d = dateFromKey(dateKey);
  d.setHours(now.getHours(), now.getMinutes(), now.getSeconds());
  return d.getTime();
}
